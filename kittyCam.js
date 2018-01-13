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

require('events').EventEmitter.prototype._maxListeners = 20;

// Johnny-Five for RPi
const raspi = require('raspi-io');
const five = require('johnny-five');
const board = new five.Board({io: new raspi()});

let i = 0;

//Check args
let doRecognition = false;
if (process.argv[0] == 'cat') doRecognition = true ;

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
    if(i > 100) return;

    // Run raspistill command to take a photo with the camera module
    let filename = 'photo/image_'+i+'.jpg';
    let args = ['-w', '320', '-h', '240', '-o', filename, '-t', '1'];
    let spawn = child_process.spawn('raspistill', args);

    spawn.on('exit', (code) => {
      console.log('A photo is saved as '+filename+ ' with exit code, ' + code);
      let timestamp = Date.now();
      i++;

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
        uploadToCloudinary(, timestamp);
        deletePhoto(imgPath); //TODO review
      }

    })
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


// PubNub to publish the data
// to make a separated web/mobile interface can subscribe the data to stream the photos in realtime.

const channel = 'kittyCam';

const pubnub = require('pubnub').init({
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

// Cloudinary to store the photos

const cloudinary = require('cloudinary');

cloudinary.config({
  cloud_name: config.cloudinary.cloud_name,
  api_key: config.cloudinary.api_key,
  api_secret: config.cloudinary.api_secret
});

function uploadToCloudinary(base64Img, timestamp) {
  cloudinary.uploader.upload(base64Img, (result) => {
    console.log(result);
    publish(result.url, timestamp); // Comment this out if you don't use PubNub
    sendSMS(result.url, timestamp); // Comment this out if you don't use Nexmo
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

rl.on('line', (input) => {
  doReco = !doReco;
  console.log('Cat recognition now is  '+doRecognition);
});