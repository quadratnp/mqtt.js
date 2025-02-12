const { Buffer } = require('buffer')
const { Transform } = require('readable-stream')
const duplexify = require('duplexify')

/* global wx */
let socketTask
let proxy
let stream

function buildProxy() {
	const _proxy = new Transform()
	_proxy._write = (chunk, encoding, next) => {
		socketTask.send({
			data: chunk.buffer,
			success() {
				next()
			},
			fail(errMsg) {
				next(new Error(errMsg))
			},
		})
	}
	_proxy._flush = (done) => {
		socketTask.close({
			success() {
				done()
			},
		})
	}

	return _proxy
}

function setDefaultOpts(opts) {
	if (!opts.hostname) {
		opts.hostname = 'localhost'
	}
	if (!opts.path) {
		opts.path = '/'
	}

	if (!opts.wsOptions) {
		opts.wsOptions = {}
	}
}

function buildUrl(opts, client) {
	const protocol = opts.protocol === 'wxs' ? 'wss' : 'ws'
	let url = `${protocol}://${opts.hostname}${opts.path}`
	if (opts.port && opts.port !== 80 && opts.port !== 443) {
		url = `${protocol}://${opts.hostname}:${opts.port}${opts.path}`
	}
	if (typeof opts.transformWsUrl === 'function') {
		url = opts.transformWsUrl(url, opts, client)
	}
	return url
}

function bindEventHandler() {
	socketTask.onOpen(() => {
		stream.setReadable(proxy)
		stream.setWritable(proxy)
		stream.emit('connect')
	})

	socketTask.onMessage((res) => {
		let { data } = res

		if (data instanceof ArrayBuffer) data = Buffer.from(data)
		else data = Buffer.from(data, 'utf8')
		proxy.push(data)
	})

	socketTask.onClose(() => {
		stream.end()
		stream.destroy()
	})

	socketTask.onError((res) => {
		stream.destroy(new Error(res.errMsg))
	})
}

function buildStream(client, opts) {
	opts.hostname = opts.hostname || opts.host

	if (!opts.hostname) {
		throw new Error('Could not determine host. Specify host manually.')
	}

	const websocketSubProtocol =
		opts.protocolId === 'MQIsdp' && opts.protocolVersion === 3
			? 'mqttv3.1'
			: 'mqtt'

	setDefaultOpts(opts)

	const url = buildUrl(opts, client)
	socketTask = wx.connectSocket({
		url,
		protocols: [websocketSubProtocol],
	})

	proxy = buildProxy()
	stream = duplexify.obj()
	stream._destroy = (err, cb) => {
		socketTask.close({
			success() {
				if (cb) cb(err)
			},
		})
	}

	const destroyRef = stream.destroy
	stream.destroy = () => {
		stream.destroy = destroyRef

		setTimeout(() => {
			socketTask.close({
				fail() {
					stream._destroy(new Error())
				},
			})
		}, 0)
	}

	bindEventHandler()

	return stream
}

module.exports = buildStream
