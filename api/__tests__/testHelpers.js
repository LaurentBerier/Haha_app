function createReqRes({ method = 'POST', headers = {}, body = {} } = {}) {
  const req = { method, headers, body };
  const res = {
    headers: {},
    statusCode: 200,
    payload: undefined,
    ended: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    send(payload) {
      this.payload = payload;
      return this;
    },
    end(payload) {
      this.ended = true;
      if (payload !== undefined) {
        this.payload = payload;
      }
      return this;
    },
    write() {
      return true;
    }
  };

  return { req, res };
}

module.exports = {
  createReqRes
};
