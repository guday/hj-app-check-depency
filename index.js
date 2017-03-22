var babylon = require("babylon");
var traverse = require("babel-traverse").default;
var generate = require("babel-generator").default;
var t = require("babel-types");

var path = require("path");
var fs = require("fs");
var appTools = require("hj-app-tools");

var that;
var filterConfig = {
    enclude: []
};


var injectArr = [];
var oldInject = null;
var providerArr = [];
var defaultProviderObj = {};
var prefix;
var logPath;

/**
 * 入口函数
 * @param source
 */
module.exports = function (source) {
    this.cacheable && this.cacheable();
    that = this;

    //格式化配置
    if (this.query.enclude) {
        filterConfig.enclude = this.query.enclude
    }
    if (this.query.exclude) {
        filterConfig.exclude = this.query.exclude
    }
    if (this.query.config) {
        providerArr = this.query.config.appAllServices || [];
        defaultProviderObj = this.query.config.defaultInjectServices || {};
        logPath = this.query.config.logPath;
        prefix = this.query.config.prefix || {
                "this": true,
                "that": true,
                "self": true,
            };
    }

    //按过滤进行处理
    var releavePath = path.relative(this.options.context, this.resourcePath);
    if (appTools.filterWithConifg(releavePath, filterConfig)) {
        //过滤到，则处理
        mainCheck(source);
    }

    return source;
};

/**
 * 检查的主入口
 * @param source
 */
function mainCheck(source) {
    //思路：
    //  1、获取inject的依赖注入，除了this，得到集合A
    //  2、获取所有依赖注入列表（静态），去除集合A，得到集合B，对不在A中的依赖，进行=>报错，汇集AB得到C
    //  3、全局检查依赖引用
    //  4、如果引用依赖在C中，认为检测到依赖。
    //  5、检查：如果依赖前缀不是this,that,self其中之一，则=>报错
    //  6、检查，如果依赖在A中，则正常，如果依赖在B中，则是未注入，=>报错

    oldInject = getOldInject();
    var newInject = {
        arr: [],
        obj: {}
    };
    var allInject = {
        arr: [],
        obj: {}
    }

    var ast = babylon.parse(source, {
        sourceType: "module"
    });

    var errorArr = [];


    var releavePath = path.relative(that.options.context, that.resourcePath);
    if (logPath) {
        console.log("==>", releavePath);
    }

    // console.log(JSON.stringify(ast))

    traverse(ast, {
        //直接调用的表达式
        CallExpression: {
            enter: function (path) {

                var node = path.node;
                //搜集依赖注入
                if (node.callee && node.callee.property && node.callee.property.name == "inject") {
                    newInject = getNewInject(node, newInject);
                    allInject = processAllInject(oldInject, newInject)
                }
            }

        },

        MemberExpression: {
            exit(path) {
     
                var node = path.node;
                var nodeName = node.property && node.property.name;
                if (allInject.obj.hasOwnProperty(nodeName)) {
                    // console.log(nodeName)
                    //匹配到依赖
                    var beforeNode = node.object;
                  
                    switch (beforeNode.type) {
                        case "ThisExpression":
                            //this，大概率没问题
                            break;
                        case "MemberExpression":
                            //多级引用，报错
                            collectError({
                                type: "injectError",
                                node: node,
                                value: "多级引用不对",
                                dst: nodeName
                            })
                            break;
                        case "Identifier":
                            var beforeNode = node.object;
                            if (!prefix[beforeNode.name]) {
                                //前缀有可能有问题，报告错误
                                collectError({
                                    type: "injectError",
                                    node: node,
                                    value: "引用前缀不对: ",
                                    dst: nodeName
                                })
                            }
                            break;
                    }
                }
            }
        },
        Identifier: {
            exit(path){
                var nodeName = path.node.name;
                if (nodeName && allInject.obj.hasOwnProperty(nodeName)) {
                    var parentNode = path.parent;
              
                    var whiteTypeMap = {
                        "ClassDeclaration": true,
                        "ExportSpecifier": true,
                        "ImportSpecifier": true,
                    }

                    if (whiteTypeMap.hasOwnProperty(parentNode.type)) {
                        return;
                    }
                    if (parentNode.type != "MemberExpression") {
                        //前缀有可能有问题，报告错误
                        collectError({
                            type: "injectError",
                            node: parentNode,
                            value: "注入需要前缀: ",
                            dst: nodeName
                        })
                    } else if (parentNode.property !== path.node) {
                        //前缀有可能有问题，报告错误
                        collectError({
                            type: "injectError",
                            node: parentNode,
                            value: "注入需要前缀: ",
                            dst: nodeName
                        })
                    }
                }

            }
        }
    });

    reportError();

    function collectError(option) {
        errorArr.push(option);
    }

    function reportError() {
        var missInjectArr = [];
        var injectErrArr = [];
        errorArr.map(function (item, i) {
            var str = "";
            var type = item.type;
            var node = item.node;
            var value = item.value;
            var dst = item.dst;

            switch (type) {
                case "injectError":
                    str = value + ": ";
                    var loc = node && node.loc;
                    if (loc) {
                        if (node) {
                            var result = generate(node);
                            str += result.code;
                            str += " ;"
                        }

                        if (dst) {
                            str += "匹配项: " + dst + " ;"
                        }
                        // if (dst) {
                        //     str += "匹配项: " + JSON.stringify(node) + " ;"
                        // }

                        str += loc.start.line + " 行 "

                    }
                    // injectErrArr.push(str);
                    console.log(str)
                    break;
                case "missInOldInject":
                    missInjectArr.push(value);
                    break
            }

        });

        if (injectErrArr.length > 0) {

        }
        if (missInjectArr.length > 0) {
            var str = "全量注入列表维护: " + missInjectArr.join(", ")
            console.log(str)
        }
    }

    /**
     * 从文件中取得注入列表
     * @param node
     * @param newInject 支持多次注入
     * @returns {{arr: Array, obj: (obj|{})}}
     */
    function getNewInject(node, newInject) {
        var args = node.arguments || [];
        var arr = newInject.arr;
        var obj = newInject.obj;
        if (arr.length > 0) {
            //多个依赖注入场景，可能会引发错误，需要提示，报告错误。
            collectError({
                type: "mutiInject",
                node: node
            })
        }
        for (var i in args) {
            var item = args[i];
            if (item.type == "StringLiteral" && item.value) {
                if (!obj[item.value]) {
                    arr.push(item.value);
                    obj[item.value] = true;
                } else {
                    //重复注入，报告错误
                    collectError({
                        type: "mutiInject",
                        node: item
                    })
                }
            }
        }
        return {
            arr, obj
        }
    }

    /**
     * 获取所有依赖（金泰）
     * @returns {*}
     */
    function getOldInject() {
        if (oldInject) {
            return oldInject;
        }

        var arr = [];
        var obj = {};
        for (var i in providerArr) {
            var item = providerArr[i];
            if (item) {
                if (!obj[item]) {
                    obj[item] = true;
                    arr.push(item)
                }
            }
        }
        oldInject = {};
        oldInject.obj = obj;
        oldInject.arr = arr;
        return oldInject;

    }

    /**
     * 处理处全量注入
     * @param oldInject
     * @param newInject
     * @returns {{obj: {}, arr: Array}}
     */
    function processAllInject(oldInject, newInject) {
        var oldObj = oldInject.obj;
        var newObj = newInject.obj;
        var arr = [];
        var obj = {};

        for (var i in oldObj) {
            if (!newObj[i]) {
                // arr.push(i);
                obj[i] = "old";
            }
        }

        for (var i in newObj) {
            if (!oldObj[i] && !defaultProviderObj[i]) {
                //新注入的列表中，在全量表中没有，也不在默认注入列表中，则报告提示错误
                collectError({
                    type: "missInOldInject",
                    value: i
                })
            }
            obj[i] = "new";
        }

        return {
            obj, arr
        }
    }

}

