/**
 * 依赖检查：
 * 1、检查每个地方使用依赖时（通过inject注入的依赖），带上了this,that或者self。
 *      a、如果用其他变量代替this，会报出一个错误;
 *                  var scope = this;
 *                  scope.BannerService.update();
 *                    执行结果  =>
 *                    依赖似乎未被正确引用(this,that,self)
 *                    scope.BannerService.update();
 *      b、不检查this在多级函数下的使用正确性：
 * 2、本检查只适用依赖的三种调用方式
 *      a、通过"."调用：xxService.variableA，或者xxService.funcA()，
 *      b、通过"[]"调用：xxService[variableA]，或者xxService.[funcA]()，
 *      c、通过自身调用：xxService，或者xxService()，
 * 3、如果服务被赋值，且未引用，则报错
 *                  var newService = BannerService;
 *                  执行结果  =>
 *                  依赖缺少引用前缀
 *                  BannerService;
 *
 * 4、如果依赖被使用，但是没有注入，则报错
 *
 */


var path = require("path");
var fs = require("fs");
var appTools = require("hj-app-tools");

var filterConfig = {
    enclude: [

    ]
};
//全局使用
var that;
var allServices = null;
var newCodeService = null;
var prefix = {
    "this": true,
    "that": true,
    "self": true,
};
var providerArr;

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
    providerArr = this.query.config && this.query.config.appAllServices || [];
    var _prefix = this.query.config && this.query.config.prefix || {
            "this": true,
            "that": true,
            "self": true,
        };

    prefix = {};
    for (var i in _prefix) {
        prefix[i] = true;
        prefix["(" + i] = true;
        prefix["[" + i] = true;
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
    //思路：先搜集依赖，然后对每个依赖进行全文件的匹配。
    var injectArr = _collectStaticInject(source);

    //app所有服务
    var allServices = _getAllService();
    var injectObj = arrToObj(injectArr);

    //与文件中服务去重，找到未注入的
    var unInjectServices = [];
    for (var i in allServices) {
        if (!injectObj[i]) {
            unInjectServices.push(i);
        }
    }

    _matchAllInject(source, injectArr, unInjectServices);

}



/**
 * 搜集静态注入
 * @param source
 * @returns {Array}
 * @private
 */
function _collectStaticInject(source) {

    source = source + "";
    //搜集 静态注入
    var regGetInject = /services\.inject\(.*?\)/g;
    var injectArrTmp = source.match(regGetInject);

    //注入格式：
    // services.inject(this, 'cache', 'GLOBAL_CONSTANT','cgiService');
    // this._initialize();

    var injectArr = [];
    var injectObj = {}; //注入去重
    for (var i in injectArrTmp) {
        var item = injectArrTmp[i] || "";

        item = item + "";
        // console.log(item);
        var arr = item.split(/['",]/);
        for (var j = 1; j < arr.length - 1; j++) {
            var word = arr[j].trim();
            if (word && !injectObj[word]) {
                injectObj[word] = true;
                injectArr.push(word);
            }
        }
    }
    // console.log(injectArr)
    return injectArr;
}

function _matchAllInject(source, injectArr, unInjectServices) {
    //思路： 将所有依赖组装成正则匹配字符串，一次性匹配，并在回调中处理。因为要用到回调，所以用replace
    //      匹配出来的数据，检查正确性
    //      区分出正确的，和可能不正确的，统统都输入到检查结果文件中。
    //      检查结果文件与源文件同目录，新增.checkResult字段
    //      文件中先显示错误信息，再显示剩下信息
    //      对错误信息，log打印出来。

    //思路： 上述是正向的依赖
    //      反向依赖： 所有this. that. self.接下来的单词，遍历出来 找出不在注入里面的，同时在所有注入库里面的
    //                也许就是有问题的，反馈出来

    //  /([^\s]*\bbb\b[^\s]*)|([^\s]*\bcc\b[^\s]*)/g
    //  /[^\s]*\$a[^\s]*/g

    injectArr = injectArr || [];
    var injectObj = {};
    for (var i in injectArr) {
        injectObj[injectArr[i]] = true;
    }

    var collectError = _collectError;
    var reportError = _reportError;
    var errorArr = [];
    var errorMap = {
        "1": "依赖似乎未被正确引用用(this,that,self)",
        "2": "依赖缺少引用前缀",
        "3": "似乎该服务未注入呢"
    };

    if (injectArr.length > 0) {
        var regMatchInject = injectArr.map(function (item) {
            var str = item + "";
            //特殊字符转换
            str = str.replace("$", "\\$");

            //正则包装  匹配所有包含该字符串的字段。 但是前缀不能为=
            str = "([^\\s=,\\(]*" + str + "[^\\s,]*)";
            return str;
        }).join("|");




        //生产最终正则
        // var regMatchInject = regMatchArr.join("");
        // var regMatchInject = /([^\s]*\bcache\b[^\s]*)|([^\s]*\bGLOBAL_CONSTANT\b[^\s]*)/g

        // console.log("info:", regMatchInject);
        // regMatchInject = "([^\\s]*\\bcache\\b[^\\s]*)"

        //去掉注释  //
        source = source.replace(/\/\/.*/g, function (matchStr) {
            // console.log("注释1: " + matchStr)
            return "";
        });
        //去掉注释  /*  */
        source = source.replace(/\/\*(\n|.)*?\*\//g, function (matchStr) {
            // console.log("注释2: " + matchStr)
            return "";
        });

        //对注入的服务，进行引用检查
        source.replace(new RegExp(regMatchInject, "g"), function () {
            var arg = arguments;
            for (var i = 1, len = arg.length; i < len - 2; i++) {
                var item = arg[i];
                // console.log(item)
                //取有效的匹配
                if (item && (item = item.trim())) {
                    var arr = item.split(".");
                    // console.log(":", item)
                    //处理.去调用子函数: this.serviceA.funcB
                    if (arr.length > 1) {
                        // console.log(i + ":" + item)
                        var prefixStr = arr[0].trim();
                        if (!prefix[prefixStr]) {
                            // console.log(arr)

                            //报错
                            collectError({
                                dstStr: item,
                                type: 1
                            })
                        }

                    } else {

                        var prefixStr = "";
                        //处理[]调用子函数: this.serviceA[funcB]
                        arr = item.split("[");
                        if (arr.length > 1) {
                            prefixStr = arr[0];
                        } else {
                            //处理直接调用
                            arr = item.split("(");
                            if (arr.length > 1) {
                                prefixStr = arr[0];
                            } else {
                                //处理单独引用
                                arr = item.split(/'|"/);
                                if (arr.length > 1) {
                                    //字符串类型，不管了
                                } else {
                                    //单独引用，报错
                                    // console.log(item)
                                    collectError({
                                        dstStr: item,
                                        type: 2
                                    })
                                }
                            }
                        }

                        if (prefixStr) {
                            if (!prefix[prefixStr]) {
                                //报错
                                console.log("：", arr)
                                // console.log("：", item)
                                collectError({
                                    dstStr: item,
                                    type: 1
                                })
                            }
                        }

                    }

                }
            }
        });


    }

    if (unInjectServices.length > 0) {
        var regUnInject = unInjectServices.map(function (item) {
            var str = item + "";
            //特殊字符转换
            str = str.replace("$", "\\$");

            //正则包装  匹配所有包含该字符串的字段。 但是前缀不能为=
            str = "([\\n\\.\\s\\[=]{1}" + str + "[\\n\\.\\s\\[\\]]{1})";
            return str;
        }).join("|");

        // console.log('unReg:', regUnInject);
        //对未注入的服务，看下是否有引用，如果有引用，那必须报告 未注入错误
        source.replace(new RegExp(regUnInject, "g"), function () {
            var arg = arguments;
            for (var i = 1, len = arg.length; i < len - 2; i++) {
                var item = arg[i];
                //取有效的匹配
                if (item && (item = item.trim())) {
                    // console.log('err:' + item)
                    collectError({
                        dstStr: item.split('.').join(" "),
                        type: 3
                    })
                }
            }
        });
    }


    reportError();


    function _collectError(option) {
        errorArr.push(option)
    }

    function _reportError() {
        var type3Error = {};
        var type3Arr = [];
        if (errorArr.length > 0) {
            var errorStr = "\n" + path.relative(that.options.context, that.resourcePath)
                + "\n"
            var arr = errorArr.filter(function (item, i) {
                if(item.type == 3) {
                    var str = item.dstStr.trim();
                    if (!type3Error[str]) {
                        type3Arr.push(str)
                        type3Error[str] = true;
                    }

                    return false;
                } else {
                    return true;
                }
            })
             arr = arr.map(function (item, i) {
                return (i + 1) + ": " + (errorMap[item.type] || "") + "\n" + item.dstStr;

            });

            errorStr += arr.join("\n") + "\n";


            errorStr += type3Arr.map(function (item, i) {
                return "'" + item  + "'";
            }).join(", ");
            showDepencyMsg(errorStr)
        }

    }

}

/**
 * 显示错误
 * @param option
 */
function showDepencyMsg(errorStr) {
    // var type = option.type;
    // var errorMap = {
    //     "1": "依赖似乎未被正确引用用(this,that,self)",
    //     "2": "依赖缺少引用前缀"
    // };
    // var errorStr = (errorMap[type] || "") + "\n" + option.dstStr;
    console.log(errorStr);
}

/**
 * 搜集App的所有服务
 * App的所有服务包括两部分，一部分在老的代码中，一部分在中间代码中
 * @returns {*}
 * @private
 */
function _getAllService() {
    //已生成数据，则返回
    if (allServices) {
        return allServices;
    }

    //取得数据
    var oldServices = _getOldCodeService();
    var newServices = _getNewCodeService();

    //合并去除空后返回
    allServices = {};
    for (var i in oldServices) {
        if (oldServices[i]) {
            allServices[i] = true;
        }
    }
    for (var i in newServices) {
        if (!allServices[i]) {
            allServices[i] = true;
        }
    }
    return allServices;
}

/**
 * 中间代码中获取所有依赖服务
 * @returns {*}
 * @private
 */
function _getNewCodeService() {
    if (newCodeService) {
        return newCodeService;
    }
    newCodeService = {};
    var newServiceAppFile = "./www_src/js/app.js";
    var realPath = path.resolve(that.options.context, newServiceAppFile);
    console.log(realPath)
    var content = fs.readFileSync(realPath, 'utf8');

    var regServices = /app\.service\s*?\(['"]{1}(.*?)['"]{1}.*?\)/g;
    content.replace(regServices, function (matchStr, dst) {
        dst = dst.trim();
        if (dst) {
            newCodeService[dst] = true;
        }
    });

    return newCodeService;
}

/**
 * 老代码的services，写死到这里吧
 * @returns {{}}
 * @private
 */
function _getOldCodeService() {

    providerArr = providerArr || [];

    var sObj = {};
    for (var i in providerArr) {
        sObj[providerArr[i]] = true
    }
    return sObj;
}

/**
 * 本函数，用于在app断点后，取得所有已经注入的依赖。
 */
function getOldServiceDemo() {
    //取得app的调用数组
    var invekeQuere = app._invokeQueue;
    var srcObj = {"factory": [], "service": []};
    $.each(invekeQuere, function (i, item) {
        if (srcObj[item[1]]) {
            srcObj[item[1]].push(item[2])
        }
    })

    //过滤出所有的服务
    var srcServiceArr = srcObj.service;
    var srcFactoryArr = srcObj.factory;
    var srcAllProviderArr = srcServiceArr.concat(srcFactoryArr);
    var srcAllProviderObj = {};

    $.each(srcAllProviderArr, function (i, item) {
        var name = item[0];
        var depency = item[1];
        if (depency.length > 0) {
            //最后一个是函数，pop掉
            var last = depency.pop();
            if (typeof(last) == "string") {
                depency.push(last);
            }
        }
        srcAllProviderObj[name] = {
            name: name,
            depency: depency
        };
    });

    //循环检查依赖，找出所有用过的依赖
    var dstProviderObj = {};
    var keys = Object.keys(srcAllProviderObj);

    var parseProviders = function (keys) {

        for (var i in keys) {
            var item = srcAllProviderObj[keys[i]];
            dstProviderObj[keys[i]] = true;
            //处理过的，不用重复处理
            if (item && !item.parsed) {
                item.parsed = true;
                var name = item.name;

                var depency = item.depency;


                parseProviders(depency);
            }
        }
    }
    //递归检查依赖
    parseProviders(keys);

    var dstProviderArr = Object.keys(dstProviderObj);
    console.log("所有服务数据：")
    console.log(JSON.stringify(dstProviderArr))
}

function arrToObj(arr) {
    var obj = {};
    for (var i in arr) {
        obj[arr[i]] = true;
    }
    return obj

}


