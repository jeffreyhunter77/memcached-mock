# memcached-mock

A mock implementation of [memcached](https://www.npmjs.com/package/memcached) to use as a replacement in tests.

This is currently a work in progresss. This version of the mock supports the following methods:

 * flush(callback)
 * get(key, callback)
 * gets(key, callback)
 * getMulti(keys, callback)
 * replace(key, value, ttl, callback)
 * set(key, value, ttl, callback)

Example usage:

```javascript
var Memcached = require('memcached-mock');

var memcached = new Memcached('localhost:11211');
```

you can then set values like so:

```javascript
memcached.set("hello", "world!", 60, function(err) {
  // ...
});
```

and retrieve those same values:

```javascript
memcached.get("hello", function(err, data) {
  if (!err)
    console.log(data); // prints: world!
});
```

Although the interface is the same, no network calls are made. Values are stored in memory and discarded when the process exits.
