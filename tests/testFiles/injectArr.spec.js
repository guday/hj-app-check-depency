/**
 */
import {services} from '../servicesFold'
import {EssentialServise} from '../servicesFold'

class LoginController extends BaseController{
    constructor() {
        //重复注入
        //注入了但是没使用
        services.inject("EssentialServise", "EssentialServise", "$location", "RegisterService");
        services.inject();
    }

    init(){
        //使用了，但是没有注入
        this.LoginService.doLogin();
    }

}

export {LoginController};