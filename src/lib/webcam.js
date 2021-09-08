"use strict";
//const enumerateDevices = require('enumerate-devices')
Object.defineProperty(exports, "__esModule", { value: true });
function default_1(deviceId) {
    return navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => devices.filter((devices) => devices.kind === 'videoinput'))
        .then((cameras) => {
        let constraints = { audio: false, video: true };
        if (cameras[deviceId]) {
            constraints['video'] = {
                deviceId: { exact: cameras[deviceId].deviceId },
            };
        }
        //  console.log(cameras)
        return window.navigator.mediaDevices.getUserMedia(constraints);
    })
        .then((stream) => {
        const video = document.createElement('video');
        //  video.src = window.URL.createObjectURL(stream)
        video.srcObject = stream;
        return new Promise((resolve) => {
            video.addEventListener('loadedmetadata', () => {
                video.play().then(() => resolve({ video: video }));
            });
        });
    })
        .catch(console.log.bind(console));
}
exports.default = default_1;
