/**
 *
 * 1.注入前缀作用域检查  injectPrefix
 *      a. this检查
 *      b. 非this检查
 * 2.注入列表检查         injectArr
 *      a. 重复注入
 *      b. 注入了但没使用
 *      c. 使用了，但没注入
 * 3.服务配置检查         injectConfig
 *      a. 全部注入维护
 *      b.
 * 4.检查范围               range
 *      a. import，export，class部分的不检查
 *      b. 不是services.inject(this, ...)方式的注入，不检查
 *
 *
 *
 */

var fs = require("fs");

var config = require("./config");
var mainCheck = require("../mainCheck");
var expect = require('chai').expect;

var options = {
    allProviderObj: config.allProviders,
    defaultProviderObj: config.defaultProviders,
};


var injectArr = fs.readFileSync("./tests/testFiles/injectArr.spec.js", "utf8");
var injectConfig = fs.readFileSync("./tests/testFiles/injectConfig.spec.js", "utf8");
var injectPrefix = fs.readFileSync("./tests/testFiles/injectPrefix.spec.js", "utf8");
var range = fs.readFileSync("./tests/testFiles/range.spec.js", "utf8");


describe("check range:", function () {
    it("import,export,class,extends位置不检查", function () {
        var result = mainCheck(range, options);
        expect([]).to.be.deep.equal([]);
    });


    it("依赖的注入检查", function () {
        var result = mainCheck(injectArr, options);
        var arr = [];
        for (var i in result) {
            arr.push({
                type: result[i].type,
                value: result[i].value
            })
        }
        // console.log(arr)
        expect(arr).to.be.deep.equal([
            {
                type: "duplicateInject",
                "value": "EssentialServise"
            },
            {
                type: "missInOldInject",
                "value": "RegisterService"
            },
            {
                type: "mutiInject",
                value: ""
            },
            {
                type: "unInject",
                value: "LoginService"
            }
        ]);

    });

    it("依赖的前缀检查 ", function () {
        var result = mainCheck(injectPrefix, options);
        var arr = [];
        for (var i in result) {
            arr.push({
                type: result[i].type,
                value: result[i].value
            })
        }
        // console.log(arr)
        expect(arr).to.be.deep.equal([
            {type: 'thisFail', value: 'TestService2'},
            {type: 'prefixWarn', value: 'TestService2'},
            {type: 'thisFail', value: 'TestService3'},
            {type: 'thisFail', value: 'TestService5'},
            {type: 'thisFail', value: 'TestService6'},
            {type: 'thisFail', value: 'TestService7'},
            {type: 'missPrefix', value: 'TestService8'},
            {type: 'prefixWarn', value: 'TestService9'}
        ]);
    });

});