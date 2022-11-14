module.exports = (feed, code) =>
  `{
  ${feed === "digitraffic" ? "stations" : "stops"
  }(feeds: ["${feed}"], name: "${code}") {
    gtfsId
    name
    code
    desc
    zoneId
    lat
    lon
    vehicleMode
    platformCode
    locationType
    stops {
      gtfsId
      name
    }
    parentStation {
      gtfsId
      name
    }
  }
}`;
