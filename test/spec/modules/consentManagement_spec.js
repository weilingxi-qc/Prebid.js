import {setConfig, requestBidsHook, resetConsentData, userCMP, consentTimeout, allowAuction} from 'modules/consentManagement';
import {gdprDataHandler} from 'src/adaptermanager';
import * as utils from 'src/utils';
import { config } from 'src/config';

let assert = require('chai').assert;
let expect = require('chai').expect;

describe('consentManagement', function () {
  describe('setConfig tests:', () => {
    describe('empty setConfig value', () => {
      beforeEach(() => {
        sinon.stub(utils, 'logInfo');
      });

      afterEach(() => {
        utils.logInfo.restore();
        config.resetConfig();
      });

      it('should use system default values', () => {
        setConfig({});
        expect(userCMP).to.be.equal('iab');
        expect(consentTimeout).to.be.equal(10000);
        expect(allowAuction).to.be.true;
        sinon.assert.callCount(utils.logInfo, 3);
      });
    });

    describe('valid setConfig value', () => {
      afterEach(() => {
        config.resetConfig();
        $$PREBID_GLOBAL$$.requestBids.removeHook(requestBidsHook);
      });
      it('results in all user settings overriding system defaults', () => {
        let allConfig = {
          cmpApi: 'iab',
          timeout: 7500,
          allowAuctionWithoutConsent: false
        };

        setConfig(allConfig);
        expect(userCMP).to.be.equal('iab');
        expect(consentTimeout).to.be.equal(7500);
        expect(allowAuction).to.be.false;
      });
    });
  });

  describe('requestBidsHook tests:', () => {
    let goodConfigWithCancelAuction = {
      cmpApi: 'iab',
      timeout: 7500,
      allowAuctionWithoutConsent: false
    };

    let goodConfigWithAllowAuction = {
      cmpApi: 'iab',
      timeout: 7500,
      allowAuctionWithoutConsent: true
    };

    let didHookReturn;

    afterEach(() => {
      gdprDataHandler.consentData = null;
      resetConsentData();
    });

    describe('error checks:', () => {
      describe('unknown CMP framework ID:', () => {
        beforeEach(() => {
          sinon.stub(utils, 'logWarn');
        });

        afterEach(() => {
          utils.logWarn.restore();
          config.resetConfig();
          $$PREBID_GLOBAL$$.requestBids.removeHook(requestBidsHook);
          resetConsentData();
        });

        it('should return Warning message and return to hooked function', () => {
          let badCMPConfig = {
            cmpApi: 'bad'
          };
          setConfig(badCMPConfig);
          expect(userCMP).to.be.equal(badCMPConfig.cmpApi);

          didHookReturn = false;

          requestBidsHook({}, () => {
            didHookReturn = true;
          });
          let consent = gdprDataHandler.getConsentData();
          sinon.assert.calledOnce(utils.logWarn);
          expect(didHookReturn).to.be.true;
          expect(consent).to.be.null;
        });
      });
    });

    describe('already known consentData:', () => {
      let cmpStub = sinon.stub();

      beforeEach(() => {
        didHookReturn = false;
        window.__cmp = function() {};
      });

      afterEach(() => {
        config.resetConfig();
        $$PREBID_GLOBAL$$.requestBids.removeHook(requestBidsHook);
        cmpStub.restore();
        delete window.__cmp;
        resetConsentData();
      });

      it('should bypass CMP and simply use previously stored consentData', () => {
        let testConsentData = {
          gdprApplies: true,
          metadata: 'xyz'
        };

        cmpStub = sinon.stub(window, '__cmp').callsFake((...args) => {
          args[2](testConsentData);
        });
        setConfig(goodConfigWithAllowAuction);
        requestBidsHook({}, () => {});
        cmpStub.restore();

        // reset the stub to ensure it wasn't called during the second round of calls
        cmpStub = sinon.stub(window, '__cmp').callsFake((...args) => {
          args[2](testConsentData);
        });

        requestBidsHook({}, () => {
          didHookReturn = true;
        });
        let consent = gdprDataHandler.getConsentData();

        expect(didHookReturn).to.be.true;
        expect(consent.consentString).to.equal(testConsentData.metadata);
        expect(consent.gdprApplies).to.be.true;
        sinon.assert.notCalled(cmpStub);
      });
    });

    describe('CMP workflow for safeframe page', () => {
      let registerStub = sinon.stub();

      beforeEach(() => {
        didHookReturn = false;
        window.$sf = {
          ext: {
            register: function() {},
            cmp: function() {}
          }
        };
        sinon.stub(utils, 'logError');
        sinon.stub(utils, 'logWarn');
      });

      afterEach(() => {
        delete window.$sf;
        config.resetConfig();
        $$PREBID_GLOBAL$$.requestBids.removeHook(requestBidsHook);
        registerStub.restore();
        utils.logError.restore();
        utils.logWarn.restore();
        resetConsentData();
      });

      it('should return the consent data from a safeframe callback', () => {
        var testConsentData = {
          data: {
            msgName: 'cmpReturn',
            vendorConsents: {
              metadata: 'abc123def',
              gdprApplies: true
            }
          }
        };
        registerStub = sinon.stub(window.$sf.ext, 'register').callsFake((...args) => {
          args[2](testConsentData.data.msgName, testConsentData.data);
        });

        setConfig(goodConfigWithAllowAuction);
        requestBidsHook({adUnits: [{ sizes: [[300, 250]] }]}, () => {
          didHookReturn = true;
        });
        let consent = gdprDataHandler.getConsentData();

        sinon.assert.notCalled(utils.logWarn);
        sinon.assert.notCalled(utils.logError);
        expect(didHookReturn).to.be.true;
        expect(consent.consentString).to.equal('abc123def');
        expect(consent.gdprApplies).to.be.true;
      });
    });

    describe('CMP workflow for iframed page', () => {
      let eventStub = sinon.stub();
      let postMessageStub = sinon.stub();
      let ifr = null;

      beforeEach(() => {
        didHookReturn = false;
        sinon.stub(utils, 'logError');
        sinon.stub(utils, 'logWarn');
        ifr = createIFrameMarker();
      });

      afterEach(() => {
        config.resetConfig();
        $$PREBID_GLOBAL$$.requestBids.removeHook(requestBidsHook);
        eventStub.restore();
        postMessageStub.restore();
        delete window.__cmp;
        utils.logError.restore();
        utils.logWarn.restore();
        resetConsentData();
        document.body.removeChild(ifr);
      });

      function createIFrameMarker() {
        var ifr = document.createElement('iframe');
        ifr.width = 0;
        ifr.height = 0;
        ifr.name = '__cmpLocator';
        document.body.appendChild(ifr);
        return ifr;
      }

      testIFramedPage('with/JSON response', {
        data: {
          __cmpReturn: {
            returnValue: {
              gdprApplies: true,
              metadata: 'BOJy+UqOJy+UqABAB+AAAAAZ+A=='
            }
          }
        }
      }, false);

      testIFramedPage('with/String response', {
        data: {
          __cmpReturn: {
            returnValue: {
              gdprApplies: true,
              metadata: 'BOJy+UqOJy+UqABAB+AAAAAZ+A=='
            }
          }
        }
      }, true);

      function testIFramedPage(testName, testConsentData, messageFormatString) {
        it(`should return the consent string from a postmessage + addEventListener response - ${testName}`, () => {
          let messageListener;
          eventStub = sinon.stub(window, 'addEventListener').callsFake((...args) => {
            // save reference to event listener for message
            // so we can return the data when the message arrives via 'postMessage'
            messageListener = args[1];
          });
          // when the iframed window sends a message to the window
          // containing the CMP, intercept it and respond back with data
          // on the message listener.
          postMessageStub = sinon.stub(window, 'postMessage').callsFake((...args) => {
            if (messageListener && args[0] && args[0].__cmpCall) {
              // take the callId from request and stamp it on the response.
              testConsentData.data.__cmpReturn.callId = args[0].__cmpCall.callId;
              // serialize the data part to String if requested
              messageListener(messageFormatString ? {
                data: JSON.stringify(testConsentData.data)
              } : testConsentData);
            }
          });

          setConfig(goodConfigWithAllowAuction);

          requestBidsHook({}, () => {
            didHookReturn = true;
          });
          let consent = gdprDataHandler.getConsentData();

          sinon.assert.notCalled(utils.logWarn);
          sinon.assert.notCalled(utils.logError);
          expect(didHookReturn).to.be.true;
          expect(consent.consentString).to.equal('BOJy+UqOJy+UqABAB+AAAAAZ+A==');
          expect(consent.gdprApplies).to.be.true;
        });
      }
    });

    describe('CMP workflow for normal pages:', () => {
      let cmpStub = sinon.stub();

      beforeEach(() => {
        didHookReturn = false;
        sinon.stub(utils, 'logError');
        sinon.stub(utils, 'logWarn');
        window.__cmp = function() {};
      });

      afterEach(() => {
        config.resetConfig();
        $$PREBID_GLOBAL$$.requestBids.removeHook(requestBidsHook);
        cmpStub.restore();
        utils.logError.restore();
        utils.logWarn.restore();
        delete window.__cmp;
        resetConsentData();
      });

      it('performs lookup check and stores consentData for a valid existing user', () => {
        let testConsentData = {
          gdprApplies: true,
          metadata: 'BOJy+UqOJy+UqABAB+AAAAAZ+A=='
        };
        cmpStub = sinon.stub(window, '__cmp').callsFake((...args) => {
          args[2](testConsentData);
        });

        setConfig(goodConfigWithAllowAuction);

        requestBidsHook({}, () => {
          didHookReturn = true;
        });
        let consent = gdprDataHandler.getConsentData();

        sinon.assert.notCalled(utils.logWarn);
        sinon.assert.notCalled(utils.logError);
        expect(didHookReturn).to.be.true;
        expect(consent.consentString).to.equal(testConsentData.metadata);
        expect(consent.gdprApplies).to.be.true;
      });

      it('throws an error when processCmpData check failed while config had allowAuction set to false', () => {
        let testConsentData = null;
        let bidsBackHandlerReturn = false;

        cmpStub = sinon.stub(window, '__cmp').callsFake((...args) => {
          args[2](testConsentData);
        });

        setConfig(goodConfigWithCancelAuction);

        requestBidsHook({ bidsBackHandler: () => bidsBackHandlerReturn = true }, () => {
          didHookReturn = true;
        });
        let consent = gdprDataHandler.getConsentData();

        sinon.assert.calledOnce(utils.logError);
        expect(didHookReturn).to.be.false;
        expect(bidsBackHandlerReturn).to.be.true;
        expect(consent).to.be.null;
      });

      it('throws a warning + stores consentData + calls callback when processCmpData check failed while config had allowAuction set to true', () => {
        let testConsentData = null;

        cmpStub = sinon.stub(window, '__cmp').callsFake((...args) => {
          args[2](testConsentData);
        });

        setConfig(goodConfigWithAllowAuction);

        requestBidsHook({}, () => {
          didHookReturn = true;
        });
        let consent = gdprDataHandler.getConsentData();

        sinon.assert.calledOnce(utils.logWarn);
        expect(didHookReturn).to.be.true;
        expect(consent.consentString).to.be.undefined;
        expect(consent.gdprApplies).to.be.undefined;
      });
    });
  });
});