import { InstanceBase, InstanceStatus, runEntrypoint } from '@companion-module/base'
import { upgradeScripts } from './upgrade.js'

import { io } from 'socket.io-client'

const SCORE_APP_EVENTS = {
	SCORE_EVENT: 'score-event',
}
const SCORE_APP_TYPES = {
	SIREN: 'siren',
	RULE_BREAKER: 'rule-breaker',
}

class WebsocketInstance extends InstanceBase {
	isInitialized = false

	urlRegex = new RegExp(/^https?:\/\/\w+(\.\w+)*(:[0-9]+)?\/?(\/[.\w]*)*$/)

	isConnected = false
	socket = null
	joinedRooms = new Set()

	async init(config) {
		this.config = config

		const url = this.config.url
		if (!url || !url.match(this.urlRegex)) {
			this.updateStatus(InstanceStatus.BadConfig, `URL is not defined or invalid`)
			return
		}

		this.joinedRooms.add('score-app')

		this.initWebSocket()
		this.setupWebSocketConnectionListener()
		this.setupWebSocketListener()
		this.isInitialized = true

		this.updateVariables()
		this.subscribeFeedbacks()
	}

	async destroy() {
		this.isInitialized = false
		this.leaveAllRooms()
		this.socket.disconnect()
		this.isConnected = false
	}

	async configUpdated(config) {
		const oldconfig = { ...this.config }

		this.config = config

		if (oldconfig['url'] !== config['url']) this.initWebSocket()
	}

	updateVariables(callerId = null) {
		let variables = new Set()

		let variableDefinitions = [
			{ name: 'Timestamp when last data was received', variableId: 'lastDataReceived' },
			{ name: 'Socket.IO connection status', variableId: 'connectionStatus' },
			{ name: 'Timestamp from latest siren event', variableId: 'dataSiren' },
			{ name: 'Rule breaker', variableId: 'dataRuleBreaker' },
		]
		variables.forEach((variable) => {
			variableDefinitions.push({
				name: variable,
				variableId: variable,
			})
		})
		this.setVariableDefinitions(variableDefinitions)
	}

	initWebSocket = () => {
		this.socket = io(this.config.url, {
			withCredentials: true,
			autoConnect: false,
		})

		this.socket.connect()
		this.isConnected = true
	}

	joinRoom = (room) => {
		if (!this.isConnected) {
			this.logMessage('Socket IO is not connected. Please connect first.', 'debug')
			return
		}
		this.socket.emit('join-room', room)
		this.joinedRooms.add(room)
		this.logMessage(`Joined room "${room}".`, 'debug')
	}

	leaveAllRooms = () => {
		if (!this.isConnected) {
			this.logMessage('Socket IO is not connected. Please connect first.', 'debug')
			return
		}

		const roomCount = this.joinedRooms.size

		this.joinedRooms.forEach((room) => leaveRoom(room))
		this.joinedRooms.clear()

		this.logMessage(`Left all ${roomCount} joined rooms.`, 'debug')
	}

	leaveRoom = (room) => {
		if (!this.isConnected) {
			this.logMessage('Socket IO is not connected. Please connect first.', 'debug')
			return
		}

		this.socket.emit('leave-room', room)
		this.joinedRooms.delete(room)
		this.logMessage(`Left room "${room}".`, 'debug')
	}

	setupWebSocketConnectionListener() {
		this.socket.on('connect', () => {
			this.updateStatus(InstanceStatus.Ok)
			this.setVariableValues({ connectionStatus: 'Connected' })
			this.logMessage('Connected to websocket server', 'debug')
			this.joinedRooms.forEach((room) => this.joinRoom(room))
		})
		this.socket.on('disconnect', () => {
			this.updateStatus(InstanceStatus.Disconnected, `Connection disconnected`)
			this.setVariableValues({ connectionStatus: 'Disconnected' })
			this.logMessage('Disconnected from websocket server', 'debug')
		})

		this.socket.io.on('reconnect_attempt', () =>
			this.logMessage('Attempting to reconnect to websocket server', 'debug')
		)
		this.socket.io.on('reconnect_failed', () => this.logMessage('Failed to reconnect to websocket server', 'error'))
		this.socket.on('error', () => this.logMessage('Error occurred in websocket server', 'error'))
	}

	setupWebSocketListener() {
		this.logMessage('Setup web socket listener', 'debug')
		this.socket.onAny((data) => this.handleSocketIoMessage(data))
	}

	handleSocketIoMessage(message) {
		this.logMessage(`Message received: ${message}`, 'debug')
		this.setVariableValues({ lastDataReceived: Date.now() })

		try {
			const { event, type, data } = JSON.parse(message)

			this.logMessage(`Socket Event received: ${event} ${SCORE_APP_EVENTS.SCORE_EVENT}`, 'debug')
			this.logMessage(`Socket Type received: ${type} ${SCORE_APP_TYPES.SIREN}`, 'debug')

			if (event === SCORE_APP_EVENTS.SCORE_EVENT) {
				switch (type) {
					case SCORE_APP_TYPES.SIREN:
						this.logMessage(`Set dataSiren to ${Date.now()}`, 'debug')
						this.setVariableValues({ dataSiren: Date.now() })
						break
					case SCORE_APP_TYPES.RULE_BREAKER:
						this.logMessage(`Set dataRuleBreaker to ${Date.now()}`, 'debug')
						this.setVariableValues({ dataRuleBreaker: data })
						break
				}

				return
			}
		} catch (error) {
			this.logMessage(`Error parsing message: ${error}`, 'error')
			return
		}
	}

	logMessage = (message, level = 'debug') => {
		if (this.config.debug_messages) {
			this.log(level, message)
		}
	}

	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'Information',
				value:
					"<strong>PLEASE READ THIS!</strong> Generic modules is only for use with custom applications. If you use this module to control a device or software on the market that more than you are using, <strong>PLEASE let us know</strong> about this software, so we can make a proper module for it. If we already support this and you use this to trigger a feature our module doesn't support, please let us know. We want companion to be as easy as possible to use for anyone.",
			},
			{
				type: 'textinput',
				id: 'url',
				label: 'Target URL',
				tooltip: 'The URL of the Socket.IO server (https://domain[:port][/path])',
				width: 12,
			},
			{
				type: 'checkbox',
				id: 'debug_messages',
				label: 'Debug messages',
				tooltip: 'Log incomming and outcomming messages',
				width: 6,
			},
		]
	}
}

runEntrypoint(WebsocketInstance, upgradeScripts)
