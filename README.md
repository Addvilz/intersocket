# This library has been deprecated

This implementation of Intersocket has been superseded by https://github.com/rfksystems/intersocket-js.
This package is dead and will receive no updates.

# Intersocket

Somewhat opinionated WS client that might or might not make WS req/res usage slightly more pleasant.

## Protocol

Intersocket sends messages as JSON text, using following format:

```json
{"id":"5b62c8aa-4318-48c9-a1f9-2d3b4c537b55","action":"go_get","payload":{"foo":1,"bar":2}}
```

Following response should be sent back from backend after the request has been processed.

```json
{"id":"5b62c8aa-4318-48c9-a1f9-2d3b4c537b55","payload":{"baz":1}}
```

The payload element will then be delivered to response callback.

## Basic usage

```js
const Socket = require('intersocket');
const WebSocket = require('ws'); // In case of Node.

const instance = new Socket({
    'url': 'ws://example.com',
    //... options
}, WebSocket); // Second argument can be anything WebSocket-like.

instance.send(
    'go_get',
    {
        foo: 1,
        bar: 2
    },
    payload => {
        // Handle payload of the response
    },
    err => {
        // Handle error
    }
);

// sent > {"id":"5b62c8aa-4318-48c9-a1f9-2d3b4c537b55","action":"go_get","payload":{"foo":1,"bar":2}}

// Clean up timers, remove active client etc.
instance.dispose();

```

## Api

Send and expect response.
`send(action<String>, payload<Any>, cbok<Function(payload)>, cberr<Function(error)>)`

Send and expect no response. Message is disposed of immediately after sending it to backend.
`notify(action<String>, payload<Any>)`

Send and expect no response. The content of the message will be whatever is given as payload, as-is
and without JSON serialization in between.
`plain(payload<Any>)`

Clear up all intervals, clear queue, disconnect the client gracefully etc. Should only be called
if given instance is to be terminated.
`dispose()`

## Options

### Behavior
`reconnectDelay<Number>` - Interval between reconnects, in milliseconds. 100 by default.

`monitorInterval<Number>` - Interval between monitor cycles, in milliseconds. 10 by default.

`retryDelay<Number>` - Delay between retries, in milliseconds. The final delay is (retry * retryDelay)ms. 1000 by default.

`maxRetry<Number>`  - Maximum number of retries. 5 by default.

`clientChange<String>` - Action to perform with messages in queue after reconnecting the socket - `fail` or `retry`. Fail will result in message error callback be invoked, retry will resend this message over the new connection. `fail` by default.

### Callbacks

`onOpen<Function(event)>` - Standard WebSocket event callback. 

`onReconnect<Function>` - Invoked before reconnect is scheduled.

`onClose<Function(event)>` - Standard WebSocket event callback. 

`onMessage<Function(event)>` - Standard WebSocket event callback. 

`onLostMessage<Function(response)>` - Message received from socket without id or something.

`onSendError<Function(error, message)>` - When Exception occurred while sending a message over the socket.

`onError<Function(event)>` - Standard WebSocket event callback. 
