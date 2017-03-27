/**
 */
import {services} from '../servicesFold'
import {EssentialServise} from '../servicesFold'

class LoginController extends BaseController {
    constructor() {
        services.inject("TestService1", "TestService2", "TestService3", "TestService4", "TestService5", "TestService6", "TestService7","TestService8", "TestService9");
    }

    init() {

        var self = this;
        var self2 = "nothing";
        var test1 = () => {
            //不报错
            this.TestService1();
        }

        var test2 = function (self3) {
            //函数作用域
            this.TestService2.getInfo();
            //使用self代替this
            self.TestService2.getInfo();
            //self2并未直接代替this，报错warn
            self2.TestService2.getInfo();
        }

        var testObj = {
            test3(){
                //语法糖函数作用域
                this.TestService3.getInfo();
            },
            test4: () => {
                //不报错
                this.TestService4.getInfo();
            },
            test5: function () {
                //对象函数
                this.TestService5.getInfo();
            },

            get test6() {
                //get
                return this.TestService6.getInfo();
            },

            set test7(value) {
                //set
                this.TestService7.setInfo(value);
            }
        }

    }

    initLocals (){
        TestService8.getInfo();
        this.TestService8.TestService9.getInfo();
    }

}

export {LoginController};