var vm = new Vue({
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
  created: function() {
    this.refreshMem();
  },
  methods: {
    refreshMem: function() {
      this.memLoading = true;
      this.$http.get('/mem').then(function(response) {
        this.mem = response.body;
        this.memLoading = false;
      }, this.errorHandler);
    },
    getInfo: function() {
      this.isLoading = true;
      this.$http.get('/rpc/getinfo').then(function(response) {
        this.getInfoResult = response.body;
        this.isLoading = false;
        this.showError = false;
      }, this.errorHandler);
    },
    pendingChannels: function() {
      this.isLoading = true;
      this.$http.get('/rpc/pendingchannels').then(function(response) {
        this.pendingChannelsResult = response.body;
        this.isLoading = false;
        this.showError = false;
      }, this.errorHandler);
    },
    listChannels: function() {
      this.isLoading = true;
      this.$http.get('/rpc/listchannels').then(function(response) {
        this.listChannelsResult = response.body;
        this.isLoading = false;
        this.showError = false;
      }, this.errorHandler);
    },
    decodePayReq: function() {
      this.isLoading = true;
      this.$http.post('/rpc/decodepayreq', {
        paymentRequest: this.paymentRequest
      }).then(function(response) {
        this.decodePayReqResult = response.body;
        this.isLoading = false;
        this.showError = false;
      }, this.errorHandler);
    },
    getNodeInfo: function() {
      this.isLoading = true;
      this.$http.post('/rpc/getnodeinfo', {
        publicKey: this.publicKey
      }).then(function(response) {
        this.getNodeInfoResult = response.body;
        this.isLoading = false;
        this.showError = false;
      }, this.errorHandler);
    },
    getNetworkInfo: function() {
      this.isLoading = true;
      this.$http.get('/rpc/getnetworkinfo').then(function(response) {
        this.getNetworkInfoResult = response.body;
        this.isLoading = false;
        this.showError = false;
      }, this.errorHandler);
    },
    errorHandler: function(err) {
      this.errorMessage = err.body;
      this.showError = true;
      this.isLoading = false;
      console.error(err);
    }
  }
});