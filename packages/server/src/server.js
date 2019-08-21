/**
 * PostRPC Server
 *
 * Implements JSON RPC v2 protocol over window.postMessage transport
 * providing sandboxed iFrames a secure/restricted communication
 * mechanism.
 *
 * In addition to responding to registered RCP's, the server can
 * publish notifications to clients.
 *
 * Usage:
 *
 * Load PostRPC.Server library into parent window and create a server
 * instance.  Register the set of methods the server will respond to
 * and then start the server:
 *
 *    const server = new PostRPC.Server('http://localhost:5001')
 *
 *    server.register('add', {a: 'Number', b: 'Number'}, 'Number', add)
 *    server.register('multiply', {a: 'Number', b: 'Number'}, 'Number', multiply)
 *
 *    server.start()
 *
 * Notifications can be published any time afterwards as:
 *
 *    server.publish('something', {stuff: 'Of interest if anyone cares'})
 *
 */

const jsonrpc = '2.0'

const parseErrorCode = -32700,
	parseErrorMessage = 'Parse error',
	parseErrorData = 'Invalid JSON was received by the server'

const invalidRequestCode = -32600,
	invalidRequestMessage = 'Invalid request',
	invalidRequestData = 'The JSON sent is not a valid request object'

const methodNotFoundCode = -32601,
	methodNotFoundMessage = 'Method not found',
	methodNotFoundData = 'The method does not exist / is not available'

const invalidParamsCode = -32602,
	invalidParamsMessage = 'Invalid params',
	invalidParamsData = 'Invalid method parameter(s)'

const internalErrorCode = -32603,
	internalErrorMessage = 'Internal error',
	internalErrorData = 'Internal JSON-RPC server error'

const invalidReturnCode = -32604,
	invalidReturnMessage = 'Invalid return',
	invalidReturnData = 'Invalid method return type'

const errorCode = -32000

const allowable = [
	'boolean',
	'null',
	'undefined',
	'number',
	'string',
	'symbol',
	'object',
	'array'
]

export default class PostRPCServer {
  /**
   * Construct server instance
   * @param {String} origin  origin uri expected from client
	 * @param {Object} childWindow target iframe's contentWindow (for comparison with MessageEvent.source)
   * @return {PostRPCServer} instance
   */
	constructor (origin, childWindow) {
		this.origin = origin
		this.childWindow = childWindow
		this.name = 'PostRPC.Server'
		this.registered = {}
		this.running = null
		this.listener = undefined
		this._logging = false
	}

  /**
   * Register RPC method
   * @param {String} method
   * @param {Object|Array[string]} param signature of method
   * @param {Type} ret signature of return
   * @param {Function} func function to perform call
   * @return {Boolean}
  */
	register (method, params, ret, func, desc) {
		if (this._logging) {
			this.logGroup('register', [
				'method: ' + method,
				'params: ' + JSON.stringify(params),
				'return: ' + JSON.stringify(ret),
				'function: function() {}',
				'description: ' + desc
			])
		}

		this.registered[method] = {
			params: params,
			return: ret,
			function: func,
			description: desc
		}

		return true
	}

  /**
   * Unregister RPC method
   * @param {String} method
   * @return {Boolean}
  */
	unregister (method) {
		if (this.registered.hasOwnProperty(method)) {
			delete this.registered[method]
			return true
		}

		return false
	}

  /**
   * Is a valid (JSON-RPC v2) request?
   * @param {Object} request
   * @return {Boolean}
  */
	isValid (request) {
		if (
			!(request.jsonrpc === jsonrpc) ||
			!(request.method) ||
			!('method' in request) ||
			(request.method && request.method.lastIndexOf('rpc.', 0) === 0)
		) {
			return false
		}

		return true
	}

  /**
   * Is method found (registered RPC)?
   * @param {Object} request
   * @return {Boolean}
  */
	isMethodFound (request) {
		if (request.method in this.registered) {
			return true
		}

		return false
	}

  /**
   * JSON-RPC v2 parse error response
   * @return {Object} response
  */
	parseErrorResponse () {
		return {
			jsonrpc,
			id: null,
			error: {
				code: parseErrorCode,
				message: parseErrorMessage,
				data: parseErrorData
			}
		}
	}

  /**
   * JSON-RPC v2 invalid request response
   * @return {Object} response
  */
	invalidRequestResponse (request) {
		return {
			jsonrpc,
			id: request.id,
			error: {
				code: invalidRequestCode,
				message: invalidRequestMessage,
				data: invalidRequestData
			}
		}
	}

  /**
   * JSON-RPC v2 method not found response
   * @return {Object} response
  */
	methodNotFoundResponse (request) {
		return {
			jsonrpc,
			id: request.id,
			error: {
				code: methodNotFoundCode,
				message: methodNotFoundMessage,
				data: methodNotFoundData
			}
		}
	}

  /**
   * JSON-RPC v2 invalid params response
   * @return {Object} response
  */
	invalidParamsResponse (request) {
		return {
			jsonrpc,
			id: request.id,
			error: {
				code: invalidParamsCode,
				message: invalidParamsMessage,
				data: invalidParamsData
			}
		}
	}

  /**
   * JSON-RPC v2 internal error response
   * @return {Object} response
  */
	internalErrorResponse (request) {
		return {
			jsonrpc,
			id: request.id,
			error: {
				code: internalErrorCode,
				message: internalErrorMessage,
				data: internalErrorData
			}
		}
	}

  /**
   * JSON-RPC v2 invalid return response
   * @return {Object} response
  */
	invalidReturnResponse (request) {
		return {
			jsonrpc,
			id: request.id,
			error: {
				code: invalidReturnCode,
				message: invalidReturnMessage,
				data: invalidReturnData
			}
		}
	}

  /**
   * JSON-RPC v2 success response
   * @return {Object} response
  */
	success (result, id) {
		return {
			jsonrpc,
			result,
			id
		}
	}

  /**
   * JSON-RPC v2 failure response
   * @return {Object} response
  */
	failure (error, id) {
		if (this._logging) {
			this.logGroup('error', [
				'error: ' + JSON.stringify(error),
				'id: ' + id
			])
		}

		if (error instanceof Error) {
			let errorData

			if (this._logging) {
				errorData = {}

				Object.getOwnPropertyNames(error).forEach((key) => {
					errorData[key] = error[key]
				})
			} else {
				errorData = error.message
			}

			return {
				jsonrpc,
				id,
				error: errorData
			}
		} else if (error) {
			const message = error.name || error.hasOwnProperty('name')
				? error.name
				: error.hasOwnProperty('error')
					? error.error
					: 'Error'

			const data = error.hasOwnProperty('message')
				? error.message
				: error.hasOwnProperty('detail')
					? error.detail
					: error.hasOwnProperty('data')
						? error.data
						: JSON.stringify(error)

			return {
				jsonrpc,
				id,
				error: {
					code: errorCode,
					message,
					data
				}
			}
		}

		return {
			jsonrpc,
			id,
			error: {
				code: errorCode,
				message: 'Error',
				data: JSON.stringify(error)
			}
		}
	}

  /**
   * JSON-RPC v2+ event notification response
   * @return {Object} response
  */
	event (result, name) {
		return {
			jsonrpc: jsonrpc,
			result: result,
			event: name,
			id: null
		}
	}

  /**
   * Publish event notification to all child iFrame windows
   * @param {String} name of event
   * @param {Object} result
   * @return {Undefined}
  */
	publish (name, result) {
		if (this.running) {
			const messages = []

			if (this._logging) {
				messages = ['publish: name: ' + name + ', result: ' + JSON.stringify(result)]
			}

			for (let i = 0; i < window.frames.length; i++) {
				this.post(window.frames[i], this.event(result, name), '*')
			}

			if (this._logging) {
				messages.push('(' + window.frames.length + ') post publish')
				this.log(messages)
			}
		} else {
			throw new Error('Server is not running')
		}
	}

  /**
   * Start the server (add postMessage event listener)
   * @return {Undefined}
  */
	start () {
		if (this.listener === undefined) {
			this.listener = this.messageHandler.bind(this)
			window.addEventListener('message', this.listener)
		}

		this.running = true
	}

  /**
   * Stop the server (remove postMessage event listener)
   * @return {Undefined}
  */
	stop () {
		if (this.listener) {
			window.removeEventListener('message', this.listener)
			this.listener = undefined
		}

		this.running = false
	}

  /**
   * Map given parameters according to required
   * @param {Object|Array} given
   * @param {Array[Array]} required
   * @return {Array} params
  */
	mapParams (given, required) {
		const params = []

		required.forEach((param, i) => {
			if (Array.isArray(given) && i < given.length) {
				params.push(given[i])
			} else if (given !== null && typeof given === 'object' && param[0] in given) {
				params.push(given[param[0]])
			}
		})

		return params
	}

  /**
   * Wrap postMessage for testablity
   * @param {Window} targetWindow
   * @param {Object} message
   * @param {String} targetOrigin
   * @return {Undefined}
  */
	post (targetWindow, message, targetOrigin) {
		if (this.running && targetWindow) {
			targetWindow.postMessage(message, targetOrigin)
		}
	}

  /**
   * Wrap request for testablity
   * @param {Object} request
   * @param {Window} targetWindow
   * @return {Undefined}
  */
	request (request, targetWindow) {

		if (this.running) {
			const messages = []

			if (this._logging) {
				messages = ['request: ' + JSON.stringify(request)]
			}

			if (!this.isValid(request)) {
				if (this._logging) {
					messages.push('post invalid')
				}

				this.post(targetWindow, this.invalidRequestResponse(request), '*')
			} else if (!this.isMethodFound(request)) {
				if (this._logging) {
					messages.push('post method not found')
				}

				this.post(targetWindow, this.methodNotFoundResponse(request), '*')
			} else {
				const rpc = this.registered[request.method]
				const func = rpc.function
				const args = this.mapParams(request.params, rpc.params)

				if (args.length !== rpc.params.length) {
					if (this._logging) {
						messages.push('post invalid params')
					}

					this.post(targetWindow, this.invalidParamsResponse(request), '*')
				} else {
					if (this._logging) {
						messages.push('call: ' + request.method + '(' + args.join(', ') + ')')
					}

					try {
						const result = func(...args)

						if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
							if (this._logging) {
								messages.push('func result is a promise')
							}

							result
								.then(res => {
									if (this._logging) {
										this.log([
											'return: ' + JSON.stringify(res),
											'post promise success'
										])
									}

									this.post(targetWindow, this.success(res, request.id), '*')
								})
								.catch(err => {
									if (this._logging) {
										this.log([
											'return: ' + JSON.stringify(err),
											'post promise failure'
										])
									}

									this.post(targetWindow, this.failure(err, request.id), '*')
								})
						} else if (allowable.indexOf(typeof result) >= 0) {
							if (this._logging) {
								messages.push('func result is allowable type')
								messages.push('return: ' + JSON.stringify(result))
								messages.push('post allowable success')
							}

							this.post(targetWindow, this.success(result, request.id), '*')
						} else if (allowable.indexOf(typeof result) < 0) {
							if (this._logging) {
								messages.push('func result is NOT allowable type')
								messages.push('type: ' + typeof result)
								messages.push('post invalid return')
							}

							this.post(targetWindow, this.invalidReturnResponse(request), '*')
						} else {
							if (this._logging) {
								messages.push('internal error')
								messages.push('post internal error failure')
							}

							this.post(targetWindow, this.internalErrorResponse(request), '*')
						}
					} catch (error) {
						if (this._logging) {
							messages.push('error: ' + JSON.stringify(error))
							messages.push('post try failure')
						}

						this.post(targetWindow, this.failure(error, request.id), '*')
					}
				}
			}
			if (this._logging) {
				this.log(messages)
			}
		}
	}

  /**
   * Handle postMessage events for parent window
   * @param {Object} event
   * @return {Undefined}
  */
	messageHandler (event) {
		if (this.running && event.origin === this.origin && event.source && event.source === this.childWindow) {
			this.request(event.data, event.source)
		}
	}

  /**
   * Enable/Disable console logging
   * @param {String} event
   * @param {Function} callback function to notify
   * @return {Undefined}
  */
	logging (enabled) {
		this._logging = enabled
	}

  /**
   * Log messages to console
   * @param {Array[String]} messages
   * @param {String} color
   * @return {Undefined}
  */
	/* istanbul ignore next */
	log (messages, color = 'blue') {
		if (this._logging) {
			if (this._logging) {
				console.group(this._name)

				messages.forEach(message => {
					console.log('%c%s', 'color:' + color, message)
				})

				console.groupEnd()
			}
		}
	}

  /**
   * Log group messages to console
   * @param {Array[String]} messages
   * @param {String} color
   * @return {Undefined}
  */
	/* istanbul ignore next */
	logGroup (group, messages, color = 'blue') {
		console.group(this._name)
		console.groupCollapsed(group)

		messages.forEach(message => {
			console.log('%c%s', 'color:' + color, message)
		})

		console.groupEnd()
		console.groupEnd()
	}

  /**
   * Log all registered RPC's
   * @return {Array[Object]} rpcs
   */
	/* istanbul ignore next */
	logRegistered (color = 'blue') {
		console.group(this._name)
		console.group('registered')

		Object.keys(this.registered)
			.map(key => [key, this.registered[key]])
			.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
			.forEach(currentLog => {
				const messages = []
				const method = currentLog[0]
				const r = currentLog[1]
				const params = []
				const params2 = []

				const types = {
					'Boolean': 'true',
					'Null': 'null',
					'Undefined': 'undefined',
					'Number': '1',
					'String': 'str',
					'Object': '{a: 1}',
					'Array': '[1,2]'
				}

				messages.push('/**')
				messages.push(' * ' + r.description)

				r.params.forEach(param => {
					messages.push(' * @param {' + param[1] + '} ' + param[0])
					params.push(param[0])
					params2.push(param[0] + ': ' + types[param[1]])
				})

				messages.push(' * @return {' + r.return + '}')
				messages.push(' */')
				messages.push(method + '(' + params.join(', ') + ')')
				messages.push('client.call(\'' + method + '\', {' + params2.join(', ') + '}, func)')

				console.groupCollapsed(method)

				messages.forEach(message => {
					console.log('%c%s', 'color:' + color, message)
				})

				console.groupEnd()
			})

		console.groupEnd()
		console.groupEnd()
	}

}
