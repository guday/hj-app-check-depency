var babylon = require("babylon");
var traverse = require("babel-traverse").default;
var generate = require("babel-generator").default;
var t = require("babel-types");

var INJECT_MAP = {
    MUTI_INJECT: "mutiInject",              //多次使用注入
    MISS_IN_OLD_INJECT: "missInOldInject",  //全量注入维护
    DUPLICATE_INJECT: "duplicateInject",    //重复注入
    UN_INJECT: "unInject",                  //使用了，但是未注入
    THIS_FAIL: "thisFail",                  //this作用域不对
    PREFIX_FAIL: "prefixFail",         //
    PREFIX_WARN: "prefixWarn",         //
    OTHER_ERROR: "otherError",         //
    MISS_PREFIX: "missPrefix",         //
}

/**
 *
 * @param source    输入源数据
 * @param param     配置
 */
module.exports = function (source, param) {
    var allProviderObj = param.allProviderObj;
    var defaultProviderObj = param.defaultProviderObj;

    var fileProviderObj = {},
        resultProviderObj = {};

    var ast = babylon.parse(source, {
        sourceType: "module"
    });

    var errorArr = [];
    var errorObj = [];

    traverse(ast, {
        //直接调用的表达式
        CallExpression: {
            enter: function (path) {
                var node = path.node;
                //搜集依赖注入
                if (node.callee && node.callee.property && node.callee.property.name == "inject") {
                    fileProviderObj = getFileInject(node, fileProviderObj);
                    resultProviderObj = processAllInject(allProviderObj, defaultProviderObj, fileProviderObj)
                    // console.log("resultProviderObj", resultProviderObj)
                }
            }

        }
    });

    traverse(ast, {
        // //直接调用的表达式
        // CallExpression: {
        //     enter: function (path) {
        //         var node = path.node;
        //         //搜集依赖注入
        //         if (node.callee && node.callee.property && node.callee.property.name == "inject") {
        //             fileProviderObj = getFileInject(node, fileProviderObj);
        //             resultProviderObj = processAllInject(allProviderObj, defaultProviderObj, fileProviderObj)
        //             // console.log("resultProviderObj", resultProviderObj)
        //         }
        //     }
        //
        // },

        Identifier: {
            exit(path){
                var nodeName = path.node.name;
                if (nodeName && resultProviderObj.hasOwnProperty(nodeName)) {
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

                            // console.log("debug:" + resultProviderObj[nodeName], nodeName)
                            if (resultProviderObj[nodeName] == "all") {
                                //说明未在显式注入，或者默认注入中，则报告未注入错误
                                collectError({
                                    type: INJECT_MAP.UN_INJECT,
                                    node: parentNode,
                                    value: nodeName,
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
                                            type: INJECT_MAP.THIS_FAIL,
                                            node: parentNode,
                                            value: nodeName,
                                            dst: nodeName
                                        })
                                    }

                                    break;
                                case "MemberExpression":
                                    //多级引用，虽然可能是正确的，先报错吧。 、
                                    //比如注入X，使用scope.this.X.get()
                                    collectError({
                                        type: INJECT_MAP.PREFIX_WARN,
                                        node: parentNode,
                                        value: nodeName,
                                        dst: nodeName
                                    })
                                    break;
                                case "Identifier":
                                    var beforeName = beforeNode.name;

                                    var deepResult = deepSelfScope(beforeName, parentPath.scope);
                                    if (deepResult == 0) {
                                        collectError({
                                            type: INJECT_MAP.PREFIX_FAIL,
                                            node: parentNode,
                                            value: nodeName,
                                            dst: nodeName
                                        })
                                    } else if (deepResult == 1) {
                                        collectError({
                                            type: INJECT_MAP.PREFIX_WARN,
                                            node: parentNode,
                                            value: nodeName,
                                            dst: nodeName
                                        })
                                    }
                                    break;
                                default :
                                    //这里是异常情况，肯定要报错
                                    collectError({
                                        type: INJECT_MAP.OTHER_ERROR,
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
                                type: INJECT_MAP.MISS_PREFIX,
                                node: parentNode,
                                value: nodeName,
                                dst: nodeName
                            })

                        }

                    } else {
                        //如果无前缀，单个引用，则报告错误
                        collectError({
                            type: INJECT_MAP.MISS_PREFIX,
                            node: parentNode,
                            value: nodeName,
                            dst: nodeName
                        })
                    }
                }
            }
        }
    });


    return errorArr;
    /**
     * 从文件中取得注入列表
     * @param node
     * @param newInject 支持多次注入
     * @returns {{arr: Array, obj: (obj|{})}}
     */
    function getFileInject(node, fileProviderObj) {
        var args = node.arguments || [];
        var obj = fileProviderObj;
        if (Object.keys(obj).length > 0) {
            //多个依赖注入场景，可能会引发错误，需要提示，报告错误。
            collectError({
                type: INJECT_MAP.MUTI_INJECT,
                value: "",
                node: node
            })
        }
        for (var i in args) {
            var item = args[i];
            if (item.type == "StringLiteral" && item.value) {
                if (!obj[item.value]) {
                    obj[item.value] = true;
                } else {
                    //重复注入，报告错误
                    collectError({
                        type: INJECT_MAP.DUPLICATE_INJECT,
                        node: item,
                        value: item.value
                    })
                }
            }
        }
        return obj;
    }

    /**
     * 处理处全量注入
     * @param oldInject
     * @param newInject
     * @returns {{obj: {}, arr: Array}}
     */
    function processAllInject(allProviderObj, defaultProviderObj, fileProviderObj) {
        var allObj = allProviderObj;
        var fileObj = fileProviderObj;
        var obj = {};

        for (var i in allObj) {
            if (!fileObj[i]) {
                obj[i] = "all";
            }
            if (defaultProviderObj[i]) {
                obj[i] = "default";
            }
        }

        for (var i in fileObj) {
            if (!allObj[i] && !defaultProviderObj[i]) {
                //新注入的列表中，在全量表中没有，也不在默认注入列表中，则报告提示错误
                collectError({
                    type: INJECT_MAP.MISS_IN_OLD_INJECT,
                    value: i
                })
            }
            obj[i] = "file";
        }

        return obj;
    }


    function collectError(option) {
        if (option.type == INJECT_MAP.MISS_IN_OLD_INJECT) {
            if (!errorObj[option.value]) {
                errorObj[option.value] = option;
                errorArr.push(option);
            }

        } else {
            errorArr.push(option);
        }

    }

}


var scopeBlockFalseMap = {
    "FunctionExpression": true,
    "ObjectMethod": true
};

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

            var node = bindings[name].path.node;

            if (node.type == "VariableDeclarator") {
                //变量申明的话，找下赋值的是不是this
                if (node.init && node.init.type == "ThisExpression") {
                    return 2;
                } else {
                    return 1
                }

            } else {
                // console.log("==》:", bindings[name].path)
                //非申明，不好找
                return 1;
            }

        } else {
            //作用域内没有引用，则上升一级
            return deepSelfScope(name, scope.parent);
        }
    } else {
        return 0;
    }
}
