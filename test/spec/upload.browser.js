/* global FakeBlob tus */

describe("tus", function () {
  describe("#Upload", function () {

    beforeEach(function () {
      jasmine.Ajax.install();
      localStorage.clear();
    });

    afterEach(function () {
      jasmine.Ajax.uninstall();
    });

    it("should resume an upload from a stored url", function (done) {
      localStorage.setItem("fingerprinted", "http://tus.io/uploads/resuming");

      var file = new FakeBlob("hello world".split(""));
      var options = {
        endpoint: "http://tus.io/uploads",
        onProgress: function () {},
        fingerprint: function () {}
      };
      spyOn(options, "fingerprint").and.returnValue("fingerprinted");
      spyOn(options, "onProgress");

      var upload = new tus.Upload(file, options);
      upload.start();

      expect(options.fingerprint).toHaveBeenCalledWith(file, upload.options);

      var req = jasmine.Ajax.requests.mostRecent();
      expect(req.url).toBe("http://tus.io/uploads/resuming");
      expect(req.method).toBe("HEAD");
      expect(req.requestHeaders["Tus-Resumable"]).toBe("1.0.0");

      req.respondWith({
        status: 204,
        responseHeaders: {
          "Upload-Length": 11,
          "Upload-Offset": 3
        }
      });

      expect(upload.url).toBe("http://tus.io/uploads/resuming");

      req = jasmine.Ajax.requests.mostRecent();
      expect(req.url).toBe("http://tus.io/uploads/resuming");
      expect(req.method).toBe("PATCH");
      expect(req.requestHeaders["Tus-Resumable"]).toBe("1.0.0");
      expect(req.requestHeaders["Upload-Offset"]).toBe(3);
      expect(req.contentType()).toBe("application/offset+octet-stream");
      expect(req.params.size).toBe(11 - 3);

      req.respondWith({
        status: 204,
        responseHeaders: {
          "Upload-Offset": 11
        }
      });

      expect(options.onProgress).toHaveBeenCalledWith(11, 11);
      done();
    });

    describe("storing of upload urls", function () {
      var options = {
        endpoint: "http://tus.io/uploads",
        fingerprint: function () {}
      };
      var startUpload = function () {
        var file = new FakeBlob("hello world".split(""));
        spyOn(options, "fingerprint").and.returnValue("fingerprinted");

        var upload = new tus.Upload(file, options);
        upload.start();

        expect(options.fingerprint).toHaveBeenCalledWith(file, upload.options);

        var req = jasmine.Ajax.requests.mostRecent();
        expect(req.url).toBe("http://tus.io/uploads");
        expect(req.method).toBe("POST");

        req.respondWith({
          status: 201,
          responseHeaders: {
            Location: "/uploads/blargh"
          }
        });

        expect(upload.url).toBe("http://tus.io/uploads/blargh");
      };
      var finishUpload = function () {
        var req = jasmine.Ajax.requests.mostRecent();
        expect(req.url).toBe("http://tus.io/uploads/blargh");
        expect(req.method).toBe("PATCH");

        req.respondWith({
          status: 204,
          responseHeaders: {
            "Upload-Offset": 11
          }
        });
      };

      it("should store and retain with default options", function (done) {
        startUpload();
        expect(localStorage.getItem("fingerprinted")).toBe("http://tus.io/uploads/blargh");
        finishUpload();
        expect(localStorage.getItem("fingerprinted")).toBe("http://tus.io/uploads/blargh");
        done();
      });

      it("should store and remove with option removeFingerprintOnSuccess set", function (done) {
        options.removeFingerprintOnSuccess = true;
        startUpload();
        expect(localStorage.getItem("fingerprinted")).toBe("http://tus.io/uploads/blargh");
        finishUpload();
        expect(localStorage.getItem("fingerprinted")).toBe(null);
        done();
      });
    });

    it("should delete upload urls on a 4XX", function (done) {
      localStorage.setItem("fingerprinted", "http://tus.io/uploads/resuming");

      var file = new FakeBlob("hello world".split(""));
      var options = {
        endpoint: "http://tus.io/uploads",
        fingerprint: function () {}
      };
      spyOn(options, "fingerprint").and.returnValue("fingerprinted");

      var upload = new tus.Upload(file, options);
      upload.start();

      var req = jasmine.Ajax.requests.mostRecent();
      expect(req.url).toBe("http://tus.io/uploads/resuming");
      expect(req.method).toBe("HEAD");

      req.respondWith({
        status: 400
      });

      expect(localStorage.getItem("fingerprinted")).toBe(null);
      done();
    });

    it("should add the request's body to errors", function () {
      var file = new FakeBlob("hello world".split(""));
      var err;
      var options = {
        endpoint: "http://tus.io/uploads",
        onError: function (e) {
          err = e;
        }
      };

      var upload = new tus.Upload(file, options);
      upload.start();

      var req = jasmine.Ajax.requests.mostRecent();
      expect(req.url).toBe("http://tus.io/uploads");
      expect(req.method).toBe("POST");

      req.respondWith({
        status: 500,
        responseText: "server_error"
      });

      expect(err.message).toBe("tus: unexpected response while creating upload, originated from request (response code: 500, response text: server_error)");
      expect(err.originalRequest).toBeDefined();
    });
  });
});

function validateUploadContent(upload, done) {
  var xhr = new XMLHttpRequest();
  xhr.open("GET", upload.url, true);
  xhr.onreadystatechange = function () {
    if (xhr.readyState != XMLHttpRequest.DONE) {
      return;
    }

    expect(xhr.status).toBe(200);
    expect(xhr.responseText).toBe("hello world");

    validateUploadMetadata(upload, done);
  };
  xhr.onerror = function (err) {
    done.fail(err);
  };
  xhr.send(null);
}

function validateUploadMetadata(upload, done) {
  var xhr = new XMLHttpRequest();
  xhr.open("HEAD", upload.url, true);
  xhr.onreadystatechange = function () {
    if (xhr.readyState != XMLHttpRequest.DONE) {
      return;
    }

    expect(xhr.status).toBe(200);
    expect(xhr.responseText).toBe("");
    expect(xhr.getResponseHeader("Tus-Resumable")).toBe("1.0.0");
    expect(xhr.getResponseHeader("Upload-Offset")).toBe("11");
    expect(xhr.getResponseHeader("Upload-Length")).toBe("11");

    // TODO: explain
    var metadataStr = xhr.getResponseHeader("Upload-Metadata");
    expect(metadataStr).toBeTruthy();
    var metadata = metadataStr.split(",");
    expect(metadata).toContain("filename aGVsbG8udHh0");
    expect(metadata).toContain("filetype dGV4dC9wbGFpbg==");
    expect(metadata).toContain("nonlatin c8WCb8WEY2U=");
    expect(metadata).toContain("number MTAw");
    expect(metadata.length).toBe(4);

    done();
  };
  xhr.onerror = function (err) {
    done.fail(err);
  };
  xhr.setRequestHeader("Tus-Resumable", "1.0.0");
  xhr.send(null);
}


describe("tus", function () {
  var originalTimeout;
    beforeEach(function () {
      originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
      jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000 * 1000;
    });

     afterEach(function () {
      jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;
    });

  it("should be supported", function () {
    expect(tus.isSupported).toBe(true);
  });

  it("should upload to a real tus server", function (done) {
    var file = new Blob("hello world".split(""));
    var options = {
      resume: false, // TODO: should we use this?
      endpoint: "https://master.tus.io/files/",
      metadata: {
        nonlatin: "słońce",
        number: 100,
        filename: "hello.txt",
        filetype: "text/plain"
      },
      onSuccess: function () {
        expect(upload.url).toMatch(/^https:\/\/master\.tus\.io\/files\//);
        console.log("Done", upload.url); // eslint-disable-line no-console

        validateUploadContent(upload, done);
      },
      onError: function (err) {
        done.fail(err);
      }
    };

    var upload = new tus.Upload(file, options);
    upload.start();
  });
});
