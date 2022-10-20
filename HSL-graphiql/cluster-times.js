const sharedTimes = require("./shared-times");

module.exports = (stop, count, startTime) => `{
  cluster(id: "${stop}") {
    name
    stops {
      ${sharedTimes(count, startTime)}
    }
  }
}`;
