/* globals Vue */
/* eslint-disable no-console */

let vm = new Vue({ /* eslint-disable-line prefer-const, no-unused-vars */
  el: '#app',
  data: {
    selected: '',
    isLoading: false,
    getInfoResult: {},
    pendingChannelsResult: {},
    listChannelsResult: {},
    paymentHash: '',
    lookupInvoiceResult: {},
    paymentRequest: '',
    decodePayReqResult: {},
    publicKey: '',
    getNodeInfoResult: {},
    getNetworkInfoResult: {},
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
    },
    async decodePayReq() {
      this.decodePayReqResult = await this.rpcCall('decodepayreq', {
        paymentRequest: this.paymentRequest,
      });
    },
});
