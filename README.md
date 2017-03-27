#hj-app-check-depency

##背景
* 我们的项目使用angular开发。
* 代码采用es6写法。注入方式使用angular2官网建议的1转2的中间代码写法。
* 依赖在constructor中通过services.inject注入。
* 由于注入量多，一些默认依赖在services中进行了默认注入。
* 如果其他函数通过this引用注入，会存在两个问题：
    1. 引用了依赖，却没注入，lint检查不出来；
    2. 使用this引用依赖，但是this写在子函数下，作用域会出问题，lint不能直接检查出来；
    3. 不小心，依赖放在其他变量后方来引用，lint检查不出来。

##工具能力
* 引用了依赖，却没注入，报告错误。
* 对依赖的前缀进行作用域检查。

##安装
* npm install hj-app-check-depency --save-dev

##webpack配置

##配置文件

##测试
