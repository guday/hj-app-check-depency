/**
 * 通过语法注入检查注入的正确性
 */
var babylon = require("babylon");
var traverse = require("babel-traverse").default;
var generate = require("babel-generator").default;
var t = require("babel-types");

var crypto = require('crypto')

var path = require("path");
var fs = require("fs");
var util = require('util');
var appTools = require("hj-app-tools");
var queryConfig = {};

var that;
var filterConfig = {
    enclude: []
};

var oldInject = null;
var providerArr = [];
var defaultProviderObj = {};
var logPath;

var scopeBlockFalseMap = {
    "FunctionExpression": true,
    "ObjectMethod": true
};

var processConfig = false;
var testFlag = false;
var md5HashMap = {};
var isInitMd5HashMap = false;
var md5HashFilePath = './.hjCheckResultTmp/hjAppCheckResult.json';
var md5HashFileTimer = null;
// var scopeBlockFalseMap = {
//     "ObjectMethod": true,
//     "ObjectMethod": true,
// }
/**
 * 入口函数
 * @param source
 */
module.exports = function (source) {
    this.cacheable && this.cacheable();
    that = this;


    //配置初始化
    if (!processConfig) {
        processConfig = true;
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
        }
        queryConfig.enclude = this.query.enclude;
        queryConfig.exclude = this.query.exclude;
        queryConfig.config = this.query.config;
    }


    //map初始化
    if (!isInitMd5HashMap) {
        isInitMd5HashMap = true;
        initMd5HashMap();
    }

    //异步处理
    var someAsyncOperation = (source, callback) => {
        //
        //按过滤进行处理
        var releavePath = path.relative(this.options.context, this.resourcePath);
        if (appTools.filterWithConifg(releavePath, filterConfig)) {
            //过滤到，则处理

            var md5Hash = md5(source);
            if (md5HashMap[releavePath] == md5Hash) {
                tryLogUnChangeNum();
                //无变化，不检查
                callback(source)
            } else {
                tryLogChangedNum();
                var hasError = mainCheck(source);
                if (hasError) {
                    md5HashMap[releavePath] = -1;
                } else {
                    md5HashMap[releavePath] = md5Hash;
                    // console.log("check depency:", releavePath)
                }

                callback(source)
            }
        } else {
            callback(source)
        }

    }

    var callback = this.async();
    someAsyncOperation(source, function (result) {
        callback(null, result);
        tryWriteHashFile();
    });

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

    //全量注入
    oldInject = getOldInject();

    //文件注入
    var newInject = {
        arr: [],
        obj: {}
    };

    //所有
    var allInject = {
        arr: [],
        obj: {}
    };

    var ast = babylon.parse(source, {
        sourceType: "module"
    });

    //错误信息数组
    var errorArr = [];

    var releavePath = path.relative(that.options.context, that.resourcePath);
    if (logPath) {
        console.log("==>", releavePath);
    }

    // console.log(JSON.stringify(ast))
    // return ;
    // 对多个类进行处理
    var classPathArr = [];
    traverse(ast, {
        ClassDeclaration: {
            enter: function (path) {
                classPathArr.push(path);
            }
        }
    });

    for (var i in classPathArr) {
        processAClass(classPathArr[i]);
    }

    function processAClass(aClassPath) {

        var classNewInject = JSON.parse(JSON.stringify(newInject));
        var classOldInject = JSON.parse(JSON.stringify(oldInject));
        var tmpAllInject = {
            arr: [],
            obj: {}
        };

        aClassPath.traverse({
            //直接调用的表达式
            CallExpression: {
                enter: function (path) {

                    var node = path.node;
                    //搜集依赖注入
                    if (node.callee && node.callee.property && node.callee.property.name == "inject") {

                        var tmpNewInject = getNewInject(node, classNewInject);
                        tmpAllInject = processAllInject(classOldInject, tmpNewInject)
                    }
                }

            },
            Identifier: {
                exit(path){
                    var nodeName = path.node.name;
                    if (nodeName && tmpAllInject.obj.hasOwnProperty(nodeName)) {
                        //匹配到注入的引用
                        var parentNode = path.parent;
                        var parentPath = path.parentPath;

                        //可忽略的白名单
                        var whiteTypeMap = {
                            "ClassDeclaration": true,
                            "ExportSpecifier": true,
                            "ImportSpecifier": true,
                        };

                        if (whiteTypeMap.hasOwnProperty(parentNode.type)) {
                            return;
                        }

                        if (parentNode.type == "MemberExpression") {
                            //表达式语法

                            if (parentNode.property == path.node) {
                                //表达式调用作为最后一个，通常是正常的调用
                                //比如，注入X，因公this.X.get()

                                // console.log("debug:" + tmpAllInject.obj[nodeName], nodeName)
                                if (tmpAllInject.obj[nodeName] == "old") {
                                    //说明未在显式注入，或者默认注入中，则报告未注入错误
                                    collectError({
                                        type: "injectError",
                                        node: parentNode,
                                        value: "似乎未注入呢",
                                        dst: nodeName
                                    })
                                }

                                //表达式调用的前缀
                                var beforeNode = parentNode.object;

                                switch (beforeNode.type) {
                                    case "ThisExpression":
                                        //this，大概率没问题
                                        // if (nodeName == "HJactionLoading") {
                                        //     console.log("=>", JSON.stringify(node))
                                        //     console.log("=>", util.inspect(path.scope.bindings))
                                        // }
                                        //在作用域上向上一级遍历，直到找到根class
                                        if (!deepThisScope(parentPath.scope)) {
                                            //this作用域并未指向根部，报错
                                            collectError({
                                                type: "injectError",
                                                node: parentNode,
                                                value: "this作用域不对",
                                                dst: nodeName
                                            })
                                        }

                                        break;
                                    case "MemberExpression":
                                        //多级引用，虽然可能是正确的，先报错吧。 、
                                        //比如注入X，使用scope.this.X.get()
                                        collectError({
                                            type: "injectError",
                                            node: parentNode,
                                            value: "多级引用不对",
                                            dst: nodeName
                                        })
                                        break;
                                    case "Identifier":
                                        var beforeName = beforeNode.name;

                                        if (!deepSelfScope(beforeName, parentPath.scope)) {
                                            collectError({
                                                type: "injectError",
                                                node: parentNode,
                                                value: "引用前缀未申明: ",
                                                dst: nodeName
                                            })
                                        }
                                        break;
                                    default :
                                        //这里是异常情况，肯定要报错
                                        collectError({
                                            type: "injectError",
                                            node: parentNode,
                                            value: "引用存在未知错误: ",
                                            dst: nodeName
                                        })
                                        break;
                                }


                                // var anotherParent = path.parentPath.node.parent;
                                // if (anotherParent.type == "MemberExpression") {
                                //     //这是有问题的
                                // }


                            } else {

                                //依赖并不是作为表达式的最后一个元素，报错，可能是不对的
                                //比如注入X， 引用this.X.func.get()
                                //前缀有可能有问题，报告错误
                                collectError({
                                    type: "injectError",
                                    node: parentNode,
                                    value: "注入需要前缀: ",
                                    dst: nodeName
                                })

                            }

                        } else {
                            //如果无前缀，单个引用，则报告错误
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
        })
    }


    // traverse(ast, {
    //     //直接调用的表达式
    //     CallExpression: {
    //         enter: function (path) {
    //
    //             var node = path.node;
    //             //搜集依赖注入
    //             if (node.callee && node.callee.property && node.callee.property.name == "inject") {
    //                 newInject = getNewInject(node, newInject);
    //                 allInject = processAllInject(oldInject, newInject)
    //             }
    //         }
    //
    //     },
    //
    //     Identifier: {
    //         exit(path){
    //             var nodeName = path.node.name;
    //             if (nodeName && allInject.obj.hasOwnProperty(nodeName)) {
    //                 //匹配到注入的引用
    //                 var parentNode = path.parent;
    //                 var parentPath = path.parentPath;
    //
    //                 //可忽略的白名单
    //                 var whiteTypeMap = {
    //                     "ClassDeclaration": true,
    //                     "ExportSpecifier": true,
    //                     "ImportSpecifier": true,
    //                 };
    //
    //                 if (whiteTypeMap.hasOwnProperty(parentNode.type)) {
    //                     return;
    //                 }
    //
    //                 if (parentNode.type == "MemberExpression") {
    //                     //表达式语法
    //
    //                     if (parentNode.property == path.node) {
    //                         //表达式调用作为最后一个，通常是正常的调用
    //                         //比如，注入X，因公this.X.get()
    //
    //                         // console.log("debug:" + allInject.obj[nodeName], nodeName)
    //                         if (allInject.obj[nodeName] == "old") {
    //                             //说明未在显式注入，或者默认注入中，则报告未注入错误
    //                             collectError({
    //                                 type: "injectError",
    //                                 node: parentNode,
    //                                 value: "似乎未注入呢",
    //                                 dst: nodeName
    //                             })
    //                         }
    //
    //                         //表达式调用的前缀
    //                         var beforeNode = parentNode.object;
    //
    //                         switch (beforeNode.type) {
    //                             case "ThisExpression":
    //                                 //this，大概率没问题
    //                                 // if (nodeName == "HJactionLoading") {
    //                                 //     console.log("=>", JSON.stringify(node))
    //                                 //     console.log("=>", util.inspect(path.scope.bindings))
    //                                 // }
    //                                 //在作用域上向上一级遍历，直到找到根class
    //                                 if (!deepThisScope(parentPath.scope)) {
    //                                     //this作用域并未指向根部，报错
    //                                     collectError({
    //                                         type: "injectError",
    //                                         node: parentNode,
    //                                         value: "this作用域不对",
    //                                         dst: nodeName
    //                                     })
    //                                 }
    //
    //                                 break;
    //                             case "MemberExpression":
    //                                 //多级引用，虽然可能是正确的，先报错吧。 、
    //                                 //比如注入X，使用scope.this.X.get()
    //                                 collectError({
    //                                     type: "injectError",
    //                                     node: parentNode,
    //                                     value: "多级引用不对",
    //                                     dst: nodeName
    //                                 })
    //                                 break;
    //                             case "Identifier":
    //                                 var beforeName = beforeNode.name;
    //
    //                                 if (!deepSelfScope(beforeName, parentPath.scope)) {
    //                                     collectError({
    //                                         type: "injectError",
    //                                         node: parentNode,
    //                                         value: "引用前缀未申明: ",
    //                                         dst: nodeName
    //                                     })
    //                                 }
    //                                 break;
    //                             default :
    //                                 //这里是异常情况，肯定要报错
    //                                 collectError({
    //                                     type: "injectError",
    //                                     node: parentNode,
    //                                     value: "引用存在未知错误: ",
    //                                     dst: nodeName
    //                                 })
    //                                 break;
    //                         }
    //
    //
    //                         // var anotherParent = path.parentPath.node.parent;
    //                         // if (anotherParent.type == "MemberExpression") {
    //                         //     //这是有问题的
    //                         // }
    //
    //
    //                     } else {
    //
    //                         //依赖并不是作为表达式的最后一个元素，报错，可能是不对的
    //                         //比如注入X， 引用this.X.func.get()
    //                         //前缀有可能有问题，报告错误
    //                         collectError({
    //                             type: "injectError",
    //                             node: parentNode,
    //                             value: "注入需要前缀: ",
    //                             dst: nodeName
    //                         })
    //
    //                     }
    //
    //                 } else {
    //                     //如果无前缀，单个引用，则报告错误
    //                     collectError({
    //                         type: "injectError",
    //                         node: parentNode,
    //                         value: "注入需要前缀: ",
    //                         dst: nodeName
    //                     })
    //                 }
    //             }
    //         }
    //     }
    // });

    return reportError();

    function collectError(option) {
        errorArr.push(option);
    }

    function reportError() {
        var missInjectArr = [];
        var injectErrArr = [];
        var duplicateInjectArr = [];
        var haveLog = false;
        var hasError = false;
        var msgArr = [];

        errorArr.map(function (item, i) {
            hasError = true;
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
                    logPathInfo();
                    logMsg(str)
                    break;
                case "missInOldInject":
                    missInjectArr.push(value);
                    break;
                case "duplicateInject":
                    duplicateInjectArr.push(value);
                    break;
            }

        });

        if (duplicateInjectArr.length > 0) {
            logPathInfo();
            var str = "重复注入: " + duplicateInjectArr.join(", ")
            logMsg(str)
        }
        if (missInjectArr.length > 0) {
            logPathInfo();
            var str = "全量注入列表维护: " + missInjectArr.join(", ")
            logMsg(str)
        }


        if (msgArr.length > 0) {
            var emitter = that.emitError || that.emitWarning;
            var message = msgArr.join("\n");
            if (emitter) {
                emitter(message)
            } else {
                console.log(message)
            }
        }


        function logPathInfo() {
            // if (!haveLog && !logPath) {
            //     haveLog = true;
            //     var releavePath = path.relative(that.options.context, that.resourcePath);
            //     logMsg("==>", releavePath);
            // }

        }

        function logMsg(msg) {
            //
            msgArr.push("===> " + msg);
        }
        return hasError;
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
                        type: "duplicateInject",
                        node: item,
                        value: item.value
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
            if (defaultProviderObj[i]) {
                obj[i] = "default";
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

    function deepThisScope(scope) {
        var blockType = scope && scope.block && scope.block.type;
        if (scopeBlockFalseMap[blockType]) {
            return false;
        } else if (blockType == "ClassMethod") {
            return true;
        }
        return deepThisScope(scope.parent);
    }

    function deepSelfScope(name, scope) {
        if (scope) {
            var bindings = scope.bindings || {};
            if (bindings[name]) {
                //找到引用
                //暂时不判断这个引用的正确性。虽然可以做到~~
                // console.log(":", name)
                //
                // console.log("::", Object.keys(bindings).join(","))
                // console.log("::", bindings[name])
                return true;
            } else {
                //作用域内没有引用，则上升一级
                return deepSelfScope(name, scope.parent);
            }
        } else {
            return false;
        }


    }

}

/**
 * 文本计算md5，处理变更
 * @param str
 * @returns {string|Buffer}
 */
function md5(str) {
    return crypto.createHash('md5').update(str).digest("hex")
}

/**
 * 初始化 filePath- md5 map
 */
function initMd5HashMap() {
    //
    var isExist = fs.existsSync(md5HashFilePath);
    // console.log("isExist",isExist)
    if (isExist) {
        //读取
        var jsonStr = fs.readFileSync(md5HashFilePath, 'utf8');
        try {
            //文件的json结构
            var jsonObj = JSON.parse(jsonStr);

            //检查结果
            var fileResult = jsonObj.result || {};
            md5HashMap = JSON.parse(JSON.stringify(fileResult));

            //queryConfig
            var config = jsonObj.config || {};

            //对比上次的配置与本次的配置， 如果配置不一致，则全部重新检查
            if (JSON.stringify(config) != JSON.stringify(queryConfig)) {
                md5HashMap = {};
            }
        }
        catch (e) {
            md5HashMap = {};
        }
    } else {
        //初始化
        md5HashMap = {};
    }
    // console.log(md5HashMap)
}

/**
 * 将map写文件，长久保存
 */
function tryWriteHashFile() {
    // console.log("try",md5HashMap)
    if (md5HashFileTimer) {
        clearTimeout(md5HashFileTimer);
        md5HashFileTimer = null;
    }

    md5HashFileTimer = setTimeout(function () {
        var result = md5HashMap;
        var config = queryConfig;
        appTools.writeToFile(md5HashFilePath, JSON.stringify({result, config}))
        //
    }, 800)
}


var unChangeNum = 0;
var unChangeTimer = null;
var unChangeProcess = null;

var changedNum = 0;
var changedTimer = null;
var changedProcess = null;

/**
 * 打印检测到的未变更数量，有个进度友好点
 */
function tryLogUnChangeNum() {
    //
    unChangeProcess = unChangeProcess || new appTools.ProgressMsg();
    unChangeNum++;

    if (unChangeTimer) {
        clearTimeout(unChangeTimer);
        unChangeTimer = null;
    }

    unChangeTimer = setTimeout(function () {
        //
        var isLast = !changedTimer;

        unChangeProcess.logMsg('check-depency：检查到未变更文件:' + unChangeNum + " 这些文件不执行依赖检查                ");
    }, 800);

    if (unChangeNum % 8 == 0) {
        unChangeProcess.logMsg('check-depency：检查到未变更文件:' + unChangeNum + " 这些文件不执行依赖检查                ")
    }

}

/**
 * 打印检测到的变更数量，有个进度友好点
 */
function tryLogChangedNum() {
    //
    changedProcess = changedProcess || new appTools.ProgressMsg();
    changedNum++;

    if (changedTimer) {
        clearTimeout(changedTimer);
        changedTimer = null;
    }

    changedTimer = setTimeout(function () {
        //
        var isLast = !unChangeTimer;

        changedProcess.logMsg('check-depency：执行检查文件: ' + changedNum + "               ");
    }, 800);

    if (changedNum % 8 == 0) {
        changedProcess.logMsg('check-depency：执行检查文件: ' + changedNum + "               ")
    }

}