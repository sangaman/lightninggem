/* globals Vue */
/* eslint-disable no-console */

function toHexString(byteArray) {
  return Array.prototype.map.call(byteArray, byte =>
    (`0${(byte & 0xFF).toString(16)}`).slice(-2)) /* eslint-disable-line no-bitwise */
    .join('');
}

let vm = new Vue({ /* eslint-disable-line prefer-const, no-unused-vars */
  el: '#app',
  data: {
    selected: '',
    isLoading: false,
    getInfoResult: {},
    pendingChannelsResult: {},
    listChannelsResult: {},
    activeChannelCount: 0,
    inactiveChannelCount: 0,
    paymentHash: '',
    lookupInvoiceResult: {},
    preimageResult: '',
    paymentRequest: '',
    decodePayReqResult: {},
    publicKey: '',
    getNodeInfoResult: {},
    getNetworkInfoResult: {},
    pubKey: '',
    amount: 1,
    queryRoutesResult: {},
    value: 1,
    addInvoiceResult: {},
    paymentHashResult: '',
    showError: false,
    errorMessage: '',
    mem: {},
    memLoading: false,
  },
  created() {
    this.refreshMem();
  },
  methods: {
    refreshMem() {
      this.memLoading = true;
      this.$http.get('/mem').then((response) => {
        this.mem = response.body;
        this.memLoading = false;
      }, this.errorHandler);
    },
    async rpcCall(endpoint, payload) {
      const rpcEndpoint = `/rpc/${endpoint}`;
      this.isLoading = true;
      try {
        let response;
        if (payload) {
          response = await this.$http.post(rpcEndpoint, payload);
        } else {
          response = await this.$http.get(rpcEndpoint);
        }
        this.isLoading = false;
        this.showError = false;
        return response.body;
      } catch (err) {
        this.errorMessage = err.body;
        this.showError = true;
        this.isLoading = false;
        console.error(err);
        return {};
      }
    },
    async getInfo() {
      this.getInfoResult = await this.rpcCall('getinfo');
    },
    async pendingChannels() {
      this.pendingChannelsResult = await this.rpcCall('pendingchannels');
    },
    async listChannels() {
      this.listChannelsResult = await this.rpcCall('listchannels');
      this.activeChannelCount = 0;
      this.inactiveChannelCount = 0;
      for (let n = 0; n < this.listChannelsResult.channels.length; n += 1) {
        if (this.listChannelsResult.channels[n].active) {
          this.activeChannelCount += 1;
        } else {
          this.inactiveChannelCount += 1;
        }
      }
    },
    async decodePayReq() {
      this.decodePayReqResult = await this.rpcCall('decodepayreq', {
        paymentRequest: this.paymentRequest,
      });
    },
    async getNodeInfo() {
      this.getNodeInfoResult = await this.rpcCall('getnodeinfo', {
        publicKey: this.publicKey,
      });
    },
    async getNetworkInfo() {
      this.getNetworkInfoResult = await this.rpcCall('getnetworkinfo');
    },
    async lookupInvoice() {
      this.lookupInvoiceResult = await this.rpcCall('lookupinvoice', {
        paymentHash: this.paymentHash,
      });
      if (this.lookupInvoiceResult.settled) {
        this.preimageResult = toHexString(new Uint8Array(this.lookupInvoiceResult.r_preimage.data));
      } else {
        this.preimageResult = '';
      }
    },
    async addInvoice() {
      this.addInvoiceResult = await this.rpcCall('addinvoice', {
        value: this.value,
      });
      this.paymentHashResult = toHexString(new Uint8Array(this.addInvoiceResult.r_hash.data));
    },
    async queryRoutes() {
      this.queryRoutesResult = await this.rpcCall('queryroutes', {
        publicKey: this.publicKey,
        amt: this.amount,
      });
    },
  },
});
