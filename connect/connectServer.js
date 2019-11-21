/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview Node.js server that provides connection services to Code City.
 * @author fraser@google.com (Neil Fraser)
 */

// Start with: node connectServer.js
'use strict';

var crypto = require('crypto');
var fs = require('fs');
var http = require('http');
var net = require('net');


// Global variables.
var CFG = null;
var queueList = Object.create(null);

/**
 * Class for one user's connection to Code City.
 * Establishes a connection and buffers the text coming from Code City.
 * @param {string} id ID of this queue.
 * @constructor
 */
var Queue = function (id) {
  // Save 'this' for closures below.
  var thisQueue = this;
  /**
   * Time that this queue was pinged by a user.  Abandoned queues are deleted.
   */
  this.lastPingTime = Date.now();
  /**
   * The index number of the most recent message added to the messages queue.
   */
  this.messageIndex = 0;
  /**
   * Queue of messages from Code City to the user.
   */
  this.messageOutput = [];
  /**
   * The index number of the most recent command received from the user.
   */
  this.commandIndex = 0;
  /**
   * Persistent TCP connection to Code City.
   */
  this.client = new net.Socket();
  this.client.on('close', function() {
    if (queueList[id]) {
      delete queueList[id];
      console.log('Code City closed session ' + id);
    }
  });
  this.client.on('error', function(error) {
    console.log('TCP error for session ' + id, error);
  });
  this.client.on('data', function(data) {
    thisQueue.messageOutput.push(data.toString());
    thisQueue.messageIndex++;
  });
  this.client.connect(CFG.remotePort, CFG.remoteHost);
};

/**
 * Load a file from disk, add substitutions, and serve to the web.
 * @param {!Object} response HTTP server response object.
 * @param {string} filename Name of template file on disk.
 * @param {!Object} subs Hash of replacement strings.
 */
function serveFile(response, filename, subs) {
  fs.readFile(filename, 'utf8', function(err, data) {
    if (err) {
      response.statusCode = 500;
      console.log(err);
      response.end('Unable to load file: ' + filename + '\n' + err);
    }
    // Inject substitutions.
    for (var name in subs) {
      data = data.replace(name, subs[name]);
    }
    // Serve page to user.
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/html');
    // Prevent a user from iframing this page and scraping the session ID.
    response.setHeader('X-Frame-Options', 'DENY');
    response.end(data);
  });
}

/**
 * Handles HTTP requests from web server.
 * @param {!Object} request HTTP server request object
 * @param {!Object} response HTTP server response object.
 */
function handleRequest(request, response) {
  if (request.connection.remoteAddress != '127.0.0.1') {
    // This check is redundant, the server is only accessible to
    // localhost connections.
    console.log('Rejecting connection from ' + request.connection.remoteAddress);
    response.end('Connection rejected.');
    return;
  }

  if (request.method == 'GET' && request.url == CFG.connectPath) {
    var cookieList = {};
    var rhc = request.headers.cookie;
    rhc && rhc.split(';').forEach(function(cookie) {
        var parts = cookie.split('=');
        cookieList[parts.shift().trim()] = decodeURI(parts.join('='));
    });
    // Decrypt the ID to ensure there was no tampering.
    var m = cookieList.ID && cookieList.ID.match(/^([0-9a-f]+)_([0-9a-f]+)$/);
    if (!m) {
      console.log('Missing login cookie.  Redirecting.');
      response.writeHead(302, {  // Temporary redirect
         'Location': CFG.loginPath
       });
      response.end('Login required.  Redirecting.');
      return;
    }
    var loginId = m[1];
    var checksum = CFG.password + loginId;
    checksum = crypto.createHash('sha3-224').update(checksum).digest('hex');
    if (checksum != m[2]) {
      console.log('Invalid login cookie: ' + cookieList.ID);
      response.writeHead(302, {  // Temporary redirect
         'Location': CFG.loginPath
       });
      response.end('Login invalid.  Redirecting.');
      return;
    }
    var seed = (Date.now() * Math.random()).toString() + cookieList.ID;
    // This ID gets transmitted a *lot* so keep it short.
    var sessionId = crypto.createHash('sha3-224').update(seed).digest('base64');
    if (Object.keys(queueList).length > 1000) {
      response.statusCode = 429;
      response.end('Too many queues open at once.');
      console.log('Too many queues open at once.');
      return;
    }
    var queue = new Queue(sessionId);
    queueList[sessionId] = queue;

    // Start a connection.
    queue.client.write('identify as ' + loginId + '\n');

    var subs = {
      '<<<SESSION_ID>>>': sessionId
    };
    serveFile(response, 'connect.html', subs);
    console.log('Hello xxxx' + loginId.substring(loginId.length - 4) +
                ', starting session ' + sessionId);

  } else if (request.method == 'POST' && request.url == CFG.pingPath) {
    var requestBody = '';
    request.on('data', function(data) {
      requestBody += data;
      if (requestBody.length > 1000000) {  // Megabyte of commands?
        console.error('Oversized JSON: ' + requestBody.length / 1024 + 'kb');
        response.statusCode = 413;
        response.end('Request Entity Too Large');
      }
    });
    request.on('end', function() {
      try {
        var receivedJson = JSON.parse(requestBody);
        if (!receivedJson['q']) {
          throw 'no queue';
        }
      } catch (e) {
        console.error('Illegal JSON');
        response.statusCode = 412;
        response.end('Illegal JSON');
        return;
      }
      ping(receivedJson, response);
    });
  } else {
    response.statusCode = 404;
    response.end('Unknown Connect URL: ' + request.url);
  }
}

function ping(receivedJson, response) {
  var q = receivedJson['q'];
  var ackMsg = receivedJson['ackMsg'];
  var cmdNum = receivedJson['cmdNum'];
  var cmds = receivedJson['cmds'];

  var queue = queueList[q];
  if (!queue) {
    console.log('Unknown session ' + q);
    response.statusCode = 404;
    response.end('Your session has timed out');
    return;
  }
  queue.lastPingTime = Date.now();

  if (typeof ackMsg == 'number') {
    if (ackMsg > queue.messageIndex) {
      var msg = 'Client ' + q + ' ackMsg ' + ackMsg +
                ', but queue.messageIndex is only ' + queue.messageIndex;
      console.error(msg);
      response.statusCode = 412;
      response.end(msg);
      return;
    }
    // Client acknowledges receipt of messages.
    // Remove them from the output list.
    queue.messageOutput.splice(0,
        queue.messageOutput.length + ackMsg - queue.messageIndex);
  }

  var delay = 0;
  if (typeof cmdNum == 'number') {
    // Client sent commands.  Increase server's index for acknowledgment.
    var currentIndex = cmdNum - cmds.length + 1;
    for (var i = 0; i < cmds.length; i++) {
      if (currentIndex > queue.commandIndex) {
        queue.commandIndex = currentIndex;
        // Send commands to Code City.
        queue.client.write(cmds[i]);
        delay += 200;
      }
      currentIndex++;
    }
    var ackCmdNextPing = true;
  } else {
    var ackCmdNextPing = false;
  }

  // Wait a fifth of a second for each command,
  // but don't wait for more than a second.
  var delay = Math.min(delay, 1000);
  var replyFunc = pong.bind(null, queue, response, ackCmdNextPing);
  setTimeout(replyFunc, delay);
}

function pong(queue, response, ackCmdNextPing) {
  var sendingJson = {};
  if (ackCmdNextPing) {
    sendingJson['ackCmd'] = queue.commandIndex;
  }
  if (queue.messageOutput.length) {
    sendingJson['msgNum'] = queue.messageIndex;
    sendingJson['msgs'] = queue.messageOutput;
  }
  response.statusCode = 200;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(sendingJson));
}

/**
 * Read the JSON configuration file.  If none is present, write a stub.
 * When done, call startup.
 */
function configureAndStartup() {
  var filename = 'connectServer.cfg';
  fs.readFile(filename, 'utf8', function(err, data) {
    if (err) {
      console.log('Configuration file connectServer.cfg not found.  ' +
                  'Creating new file.');
      data = {
        // Internal port for this HTTP server.  Nginx hides this from users.
        httpPort: 7782,
        // Path to the login page.
        loginPath: '/login',
        // Path to the connect page.
        connectPath: '/connect',
        // Path to the ping API.
        pingPath: '/ping',
        // Host of Code City.
        remoteHost: 'localhost',
        // Port of Code City.
        remotePort: 7777,
        // Age in seconds of abandoned queues to be closed.
        connectionTimeout: 300,
        // Random password for cookie encryption and salt for login IDs.
        password: 'zzzzzzzzzzzzzzzz'
      };
      data = JSON.stringify(data, null, 2);
      fs.writeFile(filename, data, 'utf8');
      return;
    }
    data = JSON.parse(data);
    if (data.password == 'zzzzzzzzzzzzzzzz') {
      console.log('Configuration file connectServer.cfg not configured.  ' +
                  'Please edit this file.');
      return;
    }
    CFG = data;
    startup();
  });
}

/**
 * Close and destroy any abandoned queues.  Called every minute.
 */
function cleanup() {
  var bestBefore = Date.now() - CFG.connectionTimeout * 1000;
  for (var id in queueList) {
    var queue = queueList[id];
    if (queue.lastPingTime < bestBefore) {
      queue.client.end();
      delete queueList[id];
      console.log('Timeout of session ' + id);
    }
  }
}

/**
 * Start up the HTTP server.
 */
function startup() {
  var server = http.createServer(handleRequest);
  server.listen(CFG.httpPort, 'localhost', function(){
    console.log('Connection server listening on port ' + CFG.httpPort);
  });
  setInterval(cleanup, 60 * 1000);
}

configureAndStartup();
