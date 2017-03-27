/**
 * 1、如果服务在import里面，则不处理
 * 2、如果服务在export里面，则不处理
 * 3、如果服务在class里面，则不处理
 * 4、如果服务在extends里面，则不处理
 */
import {services} from '../servicesFold'
import {EssentialServise} from '../servicesFold'

class LoginService extends EssentialServise{
    constructor() {
        services.inject();
    }


}

export {LoginService};