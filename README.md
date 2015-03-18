# memcached-mock

A mock implementation of [memcached](https://www.npmjs.com/package/memcached) to use as a replacement in tests.

This is currently a work in progresss. This version of the mock supports the following methods:

 * add(key, value, ttl, callback)
 * append(key, value, callback)
 * cachedump(server, slabid, limit, callback)
 * cas(key, value, cas, ttl, callback)
 * decr(key, amount, callback)
 * del(key, callback)
 * end()
 * flush(callback)
 * get(key, callback)
 * gets(key, callback)
 * getMulti(keys, callback)
 * incr(key, amount, callback)
 * items(callback)
 * prepend(key, value, callback)
 * replace(key, value, ttl, callback)
 * set(key, value, ttl, callback)
 * settings(callback)
 * slabs(callback)
 * stats(callback)
 * version(callback)

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

The mock supports one additional method: `cache()`, which provides direct access to the underlying in-memory cache. Values in the cache object are also objects with the following properties:

 * **value** - The stored value
 * **expires** - The time in milliseconds when this entry expires
 * **cas** - The CAS id of the entry

If needed, individual mock instances of Memcached get be configured to use separate caches, by setting the cache object to use, like so:

```javascript
var Memcached = require('memcached-mock');

var memcached = new Memcached('192.168.0.1:11211');

memcached.cache({}); // set the cache object
```
