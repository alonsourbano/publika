module.exports = (feed, from, to) => `{
  stations(ids: ["${feed}:${from}", "${feed}:${to}"]) {
    gtfsId
    name
    lat
    lon
  }
}`;
