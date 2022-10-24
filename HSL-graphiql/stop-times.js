const sharedTimes = require("./shared-times");

module.exports = (type, stop, count, startTime) => {
  return `{
    ${type}(id: "HSL:${stop}") {
      ${sharedTimes(count, startTime)}
    }
  }`;
};
