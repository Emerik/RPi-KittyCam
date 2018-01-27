/*
 * KittyCam
 * A Raspberry Pi app using a camera PIR motion sensor, with cat facial detection
 *
 * Tomomi Imura (@girlie_mac)
 */

'use strict'

const config = require('./config');
const fs = require('fs');
const child_process = require('child_process');
var PubNub = require('pubnub');

require('events').EventEmitter.prototype._maxListeners = 20;

// Johnny-Five for RPi
const raspi = require('raspi-io');
const five = require('johnny-five');
const board = new five.Board({io: new raspi()});

//Global variables
let i = 0;
let maxPicture = 25;
let lastPicture = Date.now();
let lastHour = -1;
let doRecognition = false;
let status = true;

//Check args
console.log('User arg : '+process.argv[2]);
if (process.argv[2] == 'cat') doRecognition = true ;

board.on('ready', () => {
  console.log('board is ready');

  // Create a new `motion` hardware instance.
  const motion = new five.Motion('P1-7'); //a PIR is wired on pin 7 (GPIO 4)

  // 'calibrated' occurs once at the beginning of a session
  motion.on('calibrated', () => {
    console.log('calibrated');
  });

  // Motion detected
  motion.on('motionstart', () => {
    console.log('------- [motionstart] -------');

    //Photo limit
    if(i > maxPicture){
      console.log('Too many picture');
      return;
    }

    if(Date.now() < lastPicture+2000){
      console.log('Too short');
      return;
    }

    if( i > 10 ){
      console.log('Picture limit per hour reached !');
      i = 0;
      lastHour = new Date().getHours();
      return;
    }

    if(new Date().getHours() == lastHour){
      console.log('Too many pictures this hour '+lastHour+'H');
      return ;
    }

    if(status == false){
      console.log('Auto mode is off');
      return;
    }

    // Take picture & upload it
    takePicture(i);
    i++;

    
  });

  // 'motionend' events
  motion.on('motionend', () => {
    console.log('------- [motionend] -------');
  });
});


function deletePhoto(imgPath) {
  fs.unlink(imgPath, (err) => {
    if (err) {
       return console.error(err);
    }
    console.log(imgPath + ' is deleted.');
  });
}

function takePicture(inc){
  // Run raspistill command to take a photo with the camera module
  let filename = 'photo/image_'+inc+'.jpg';
  let args = ['-w', '1024', '-h', '780', '-o', filename, '-t', '1000'];
  let spawn = child_process.spawn('raspistill', args);
  let timestamp = Date.now();

  spawn.on('exit', (code) => {
    console.log('A photo is saved as '+filename+ ' with exit code, ' + code);
    

    if (doRecognition) {
    // Detect cats from photos

      if((/jpg$/).test(filename)) { // Ignore the temp filenames like image_001.jpg~
        let imgPath = __dirname + '/' + filename;

        // Child process: read the file and detect cats with KittyDar
        let args = [imgPath];
        let fork = child_process.fork(__dirname + '/detectCatsFromPhoto.js');
        fork.send(args);

        // the child process is completed
        fork.on('message', (base64) => {
          if(base64) {
            uploadToCloudinary(base64, timestamp);
          }

          // Once done, delete the photo to clear up the space
          deletePhoto(imgPath);
        });
      }
    }
    else {
      uploadToCloudinary(filename, timestamp);
      deletePhoto(filename); //TODO review
    }
  })
}

// PubNub to publish the data
// to make a separated web/mobile interface can subscribe the data to stream the photos in realtime.

const channel = 'kittyCam';

var pubnub = new PubNub({
  subscribe_key: config.pubnub.subscribe_key,
  publish_key: config.pubnub.publish_key
});

function publish(url, timestamp) {
  pubnub.publish({
    channel: channel,
    message: {image: url, timestamp: timestamp},
    callback: (m) => {console.log(m);},
    error: (err) => {console.log(err);}
  });
}

function publishAcq(msg, timestamp){
  pubnub.publish({
    channel: channel,
    message: {type: 'status', message: msg, timestamp: timestamp},
    callback: (m) => {console.log(m);},
    error: (err) => {console.log(err);}
  });
}

pubnub.addListener({
  status: function(statusEvent) {
      if (statusEvent.category === "PNConnectedCategory") {
          console.log('Status event');
          //publishSampleMessage();
      }
  },
  message: function(message) {
      console.log('['+message.message.cmd+'] command received');
      //What to do
      let timestamp = Date.now();
      switch(message.message.cmd){
        case 'takePicture':
          //Call picture function
          takePicture(333);
          break;
        case 'stop':
          status = false;
          publishAcq('false', timestamp);
          break;
        case 'start':
          status = true;
          publishAcq('true', timestamp);
          break;
        default:
          break;
      }
  },
  presence: function(presenceEvent) {
      // handle presence
      console.log('Presence event');
  }
})      
console.log("Subscribing..");
pubnub.subscribe({
  channels: [channel] 
});

// Cloudinary to store the photos

const cloudinary = require('cloudinary');

cloudinary.config({
  cloud_name: config.cloudinary.cloud_name,
  api_key: config.cloudinary.api_key,
  api_secret: config.cloudinary.api_secret
});

function uploadToCloudinary(base64Img, timestamp) {
  cloudinary.uploader.upload(base64Img, (result) => {
    console.log(result.url);
    publish(result.url, timestamp); // Comment this out if you don't use PubNub
  });
}


// Handle user input

const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.on('SIGINT', () => {
  console.log('Good Bye Fur Friend !');
  process.exit();
});

/*rl.on('line', (input) => {
  if(input == 'cat') doReco = !doReco;
  if(input == 'reset') lastHour=-1;
  console.log('Time '+new Date().toUTCString()+' LH:'+lastHour)
  console.log('Cat recognition now is  '+doRecognition);
});*/