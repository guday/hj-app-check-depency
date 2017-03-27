
import {BaseView} from 'js/base.view.js'
import {services} from 'js/app.services.js'

class DepositAreaController extends BaseView {
    constructor($scope) {
        super($scope);
        this.$scope = $scope;

        services.inject(this, 'GLOBAL_CONSTANT', 'GLOBAL_CONSTANT', 'ProdCommonActionService', 'ProdInfoService', 'CommonClickFnService', 'DepositService', '$sce', "BannerService", "$timeout", "utils");

        this._initialize();

    }

    /**
     * 初始化
     * @private
     */
    _initialize() {
    }

}

export {DepositAreaController};