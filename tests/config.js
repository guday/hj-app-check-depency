//app所有注入的服务名字，有空更新就行，用于检查使用了，但是没注入服务的地方。
var allProviders = [
    "$location",
    "$q",
    "EssentialServise",
    "LoginService",
    "TestService",
    "TestService1",
    "TestService2",
    "TestService3",
    "TestService4",
    "TestService5",
    "TestService6",
    "TestService7",
    "TestService8",
    "TestService9",
];

var defaultProviders = [
    "$location",
    "$q"
];

function getAllProviders() {

    var obj = {};
    for (var i in allProviders) {
        if (!obj[allProviders[i]]) {
            obj[allProviders[i]] = true;
        }
    }
    return obj;
}

function getDefaultProviders() {

    var obj = {};
    for (var i in defaultProviders) {
        if (!obj[defaultProviders[i]]) {
            obj[defaultProviders[i]] = true;
        }
    }
    return obj;
}
exports.allProviders = getAllProviders();
exports.defaultProviders = getDefaultProviders();
