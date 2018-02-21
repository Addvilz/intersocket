'use strict';
const UUIDv4 = require('uuid').v4;

const voidHandler = (e) => {
};

const millisToDuration = (millis) => {
    const hours = Math.floor(millis / (1000 * 60 * 60) % 60);
    const minutes = Math.floor(millis / (1000 * 60) % 60);
    const seconds = Math.floor(millis / 1000 % 60);
    const ms = Math.floor(millis % 1000);

    let response = '';

    if (0 < hours) {
        response += hours + 'h ';
    }

    if (0 < minutes) {
        response += minutes + 'm ';
    }

    if (0 < seconds) {
        response += seconds + 's ';
    }

    if (0 < ms) {
        response += ms + 'ms ';
    }

    if (1000 <= millis) {
        response += '(' + millis + 'ms total)';
    }

    return response.trim();
};

class InterMessage {
    constructor(action, payload, cbok, cberr) {
        this.id = UUIDv4();
        this.action = action;
        this.payload = payload;
        this.cbok = cbok instanceof Function ? cbok : voidHandler;
        this.cberr = cberr instanceof Function ? cberr : voidHandler;

        this.createdAt = (new Date()) * 1;
        this.sentAt = null;
        this.isNotification = false;

        this.clientId = null;
        this.isSent = false;
        this.nextAttempt = null;
        this.retries = 0;
    }
}

const Intersocket = function (options, client) {
    if ('undefined' === typeof options.url) {
        throw 'Missing WS target URL: options[url]'
    }

    if (undefined === client && undefined !== WebSocket) {
        client = WebSocket;
    }

    if (!client) {
        throw 'Client not provided';
    }

    const __WsClient = client;

    const __reconnectDelay = typeof options.reconnectDelay === 'number' ? options.reconnectDelay : 100;
    const __monitorInterval = typeof options.monitorInterval === 'number' ? options.monitorInterval : 10;
    const __retryDelay = typeof options.retryDelay === 'number' ? options.retryDelay : 1000;
    const __maxRetry = typeof options.maxRetry === 'number' ? options.maxRetry : 5;
    const __clientChange = typeof options.clientChange === 'string' ? options.clientChange : 'fail';

    const __onOpenCb = options.onOpen instanceof Function ? options.onOpen : voidHandler;
    const __onReconnectCb = options.onReconnect instanceof Function ? options.onReconnect : voidHandler;
    const __onCloseCb = options.onClose instanceof Function ? options.onClose : voidHandler;
    const __onMessageCb = options.onMessage instanceof Function ? options.onMessage : voidHandler;
    const __onLostMessageCb = options.onLostMessage instanceof Function ? options.onLostMessage : voidHandler;
    const __onSendErrorCb = options.onSendError instanceof Function ? options.onSendError : voidHandler;
    const __onErrorCb = options.onError instanceof Function ? options.onError : voidHandler;

    const __debugEnabled = typeof options.debug === 'boolean' ? options.debug : false;

    const __queue = [];

    let __disposed = false;
    let __client = null;
    let __monitor;

    this.dispose = () => {
        __queue.length = 0;
        __disposed = true;

        if (__monitor) {
            clearInterval(__monitor);
        }

        if (__client && __client.readyState < 2) {
            __client.close(-1, 'Disposing of client');
        }
    };

    this.send = (action, payload, cbok, cberr) => {
        if (false === (typeof action === 'string') || '' === action) {
            throw 'Notification action must be non-empty string'
        }

        const message = new InterMessage(action, payload, cbok, cberr);
        __queue.push(message);
        return message;
    };

    this.notify = (action, payload) => {
        if (false === (typeof action === 'string') || '' === action) {
            throw 'Notification action must be non-empty string'
        }

        const message = new InterMessage(action, payload, voidHandler, voidHandler);
        message.isNotification = true;
        __queue.push(message);
        return message;
    };

    this.plain = (payload) => {
        const message = new InterMessage(null, payload, voidHandler, voidHandler);
        message.isNotification = true;
        __queue.push(message);
        return message;
    };

    this.__monitorTick = () => {
        if (0 === __queue.length) {
            return;
        }

        const currentTime = new Date() * 1;

        for (const index in __queue) {
            const message = __queue[index];

            if (message.isSent) {
                if (message.clientId !== __client.__id) {
                    if ('fail' === __clientChange) {
                        message.cberr(new Error('Client changed'));
                        __queue.splice(index, 1);
                        continue;
                    }

                    if ('retry' === __clientChange) {
                        message.isSent = false;
                        message.sentAt = null;
                    }
                } else {
                    continue;
                }
            }

            if (null === __client || 1 !== __client.readyState) {
                // Client is not ready yet
                continue;
            }

            // Adhere to resend delay
            if (message.nextAttempt && message.nextAttempt > currentTime) {
                continue;
            }

            try {
                if (!message.action) {
                    __client.send(message.payload);
                } else {
                    __client.send(JSON.stringify({
                        id: message.id,
                        action: message.action,
                        payload: message.payload
                    }));
                }

                if (message.isNotification) {
                    __queue.splice(index, 1);
                    continue
                }

                message.clientId = __client.__id;
                message.isSent = true;
                message.sentAt = currentTime;

                if (__debugEnabled) {
                    console.groupCollapsed("OUT\t["+ message.id +"]\t[" + message.action + ']');
                    console.log('message: ', message);
                    console.log('url', options.url);
                    console.groupEnd();
                }

            } catch (e) {
                __onSendErrorCb(e, message);

                message.retries++;
                message.nextAttempt = ((new Date) * 1) + (__retryDelay * message.retries);

                if (message.retries >= __maxRetry) {
                    message.cberr(e);
                    __queue.splice(index, 1)
                }
            }
        }
    };

    this.__init = () => {
        __monitor = setInterval(this.__monitorTick, __monitorInterval);
        __client = this.__createClient();
    };


    this.__onOpen = (e) => {
        __onOpenCb(e);
    };

    this.__onError = (e) => {
        __onErrorCb(e);
    };

    this.__onMessage = (e) => {
        const receivedAt = (new Date()) * 1;
        __onMessageCb(e);

        const response = JSON.parse(e.data);

        if (!response.id) {
            if (__debugEnabled) {
                console.groupCollapsed('Received unknown payload');
                console.log('response: ', response);
                console.log('url', options.url);
                console.groupEnd();
            }

            __onLostMessageCb(e);
            return;
        }

        const indexOf = __queue.findIndex(m => {
            return m.id === response.id;
        });

        if (-1 === indexOf) {
            if (__debugEnabled) {
                console.groupCollapsed('Received message with unknown id: ' + message.action);
                console.log('message: ', message);
                console.log('response: ', response);
                console.log('queue: ', __queue);
                console.log('url', options.url);
                console.groupEnd();
            }

            __onLostMessageCb(e);
            return;
        }

        const message = __queue[indexOf];

        if (typeof response.action !== 'undefined' && response.action === 'error') {
            message.cberr(response.payload);

            if (__debugEnabled) {
                console.groupCollapsed('Received failed socket message: ' + message.action);
                console.log('message: ', message);
                console.log('response: ', response);
                console.log('url', options.url);
                console.groupEnd();
            }
        } else {
            message.cbok(response.payload);
            const elapsed = receivedAt - message.createdAt;

            if (__debugEnabled) {
                console.groupCollapsed(
                    "IN \t"
                    + '[' + message.id + "]\t"
                    + '[' + message.action + '] '
                    + 'after ' + millisToDuration(elapsed)
                );

                console.log('message: ', message);
                console.log('response: ', response);
                console.log('url', options.url);
                console.groupEnd();
            }
        }

        __queue.splice(indexOf, 1);
    };

    this.__onClose = (e) => {
        __onCloseCb(e);

        if (__disposed) {
            return;
        }

        __onReconnectCb();

        setTimeout(() => {
            __client = this.__createClient();
        }, __reconnectDelay);
    };

    this.__createClient = () => {
        let client;

        try {
            client = new __WsClient(options.url);
        } catch (e) {
            this.__onClose(e);
            return null;
        }

        client.__id = UUIDv4();
        client.onopen = this.__onOpen;
        client.onerror = this.__onError;
        client.onmessage = this.__onMessage;
        client.onclose = this.__onClose;

        return client;
    };

    this.__init();
};

export default Intersocket;
