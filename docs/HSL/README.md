# Publika > HSL

HSL public transport schedule times module for MirrorMirror project

![Module](../fgayavtw.png)

Quick config example:

```js
{
  module: "publika",
  position: "top_left",
  config: {
    feed: "HSL",
    stopTimesCount: 3,
    stops: [
      { id: 1000118, type: "station" },
      1020455,
      { id: 1000204, type: "station" },
      1030701,
      { id: 4000004, type: "station" }
    ]
  }
}
```

Read the full specifications: [README.md](../../README.md#publika)
