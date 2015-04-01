# memcached-mock

A mock implementation of [memcached](https://www.npmjs.com/package/memcached) to use as a replacement in tests.

This is an in-memory implementation. It implements the documented, public API of the `memcached` module. The interface is the same, however, no network calls are made. Values are stored in memory and discarded when the process exits.

## Getting Started

### Installation

Install the module with npm:

```
npm install memcached-mock
```

### Usage

Use `memcached-mock` the same as if it were `memcached`:

```javascript
var Memcached = require('memcached-mock');

var memcached = new Memcached('localhost:11211');

memcached.set("hello", "world!", 60, function(err) {
  
  if (!err)
    memcached.get("hello", function(err, data) {
      console.log(data); // prints: world!
    });

});
```

If your code does not allow you to easily replace the instance of Memcached being used for testing, you may choose to use a tool like [proxyquire](https://www.npmjs.com/package/proxyquire). That would look something like the following.

**lib/cache.js:**

```javascript
var Memcached = require('memcached');

// ...
```

**test/unit/cache.js:**

```javascript
var proxyquire = require('proxyquire')
  , memcachedMock = require('memcached-mock')
;

module.exports.testSomething = function(done) {
  var cache = proxyquire('../../lib/cache', {memcached: memcachedMock});
  
  // continue with test...
}
```

## Limitations

This module is intended to work as a drop-in replacement in simple use cases. It allows you to provide a known, deterministic state for your tests. It might also serve as a starting point for more complex interactions. Some simulations, however, may require extra work.

Methods for accessing server information (such as `stats` or `settings`), for example, are mostly stubs that always return the same data. If you'd like to return different data, you'll need to provide your own replacements for those. Similarly, the methods for getting and setting cache values are fully functional, but if you'd like to simulate something beyond a connection to a single cache cluster, at a minimum you'll need to set up your Memcached instances to use the appropriate cache object for their server connection settings. By default, server strings are not examined and all instances share the same cache store. See documentation on the `cache()` method for more details.

## Asynchronous Callbacks

The work of making any cache updates is done synchronously. So, for example, take this code:

```javascript
var memcached = new Memcached("127.0.0.1:11211");

memcached.set("foo", "bar", 0, function() { /* ... */ });

memcached.get("foo", function(err, data) {
  console.log("foo=%s", data); // prints: foo=bar
});
```

That will work because the cached has been updated by the time the call to the `set` method returns. Note, however, that callbacks are always invoked asynchronously. This is essential for testing the behavior your code will see from an actual connection to memcached. That means that this code will not work:

```javascript
var memcached = new Memcached("127.0.0.1:11211");

memcached.flush(function() {
  memcached.set("bar", "foo", 0, function() { /* ... */ });
});

memcached.get("bar", function(err, data) {
  console.log("bar=%s", data); // bar has not been set yet!
});
```

You may choose to exploit this fact in your tests. You can, for example, safely flush a cache in your setup or teardown code without waiting for the callback to be invoked.

## API

### Constructor

#### new Memcached(serverLocations, options)

  * `serverLocations`: **String**, **Array**, or **Object** Simulated connections
  * `options`: **Object** Client options

Constructs a new mock Memcached instance. This simulates the interface of Memcached, but most settings do not have an effect. No connections are established with a server, and the value of `serverLocations` does not change the behavior of the mock. The only option that does have an effect is `maxExpiration`, which alters how TTL values are interpreted.

### Public Instance Methods


#### memcached.add(key, value, ttl, callback)

 * `key`: **String** Name of the key
 * `value`: **Mixed** Value to associate with the key
 * `ttl`: **Number** Expiration time for the key in seconds
 * `callback`: **Function** On completion callback

Add a new mapping if the key does not yet exist in the cache.

#### memcached.append(key, value, callback)

 * `key`: **String** Name of the key
 * `value`: **Mixed** The value to append
 * `callback`: **Function** On completion callback

Append data to an existing key's value. The key must already exist in the cache.

#### memcached.cache()

This method is not part of the memcached interface. It provides direct access to the underlying in-memory cache. Values in the cache object are also objects with the following properties:

 * **value** - The stored value
 * **expires** - The time in milliseconds when this entry expires
 * **cas** - The CAS id of the entry

This can be used to directly alter or verify the contents of the cache. For example, if in a unit test you wanted to verify that the key "session-1" contained the object `{userId: 2}`, that verification code might look like:

```javascript
var cache = memcached.cache();

assert.deepEqual(cache["session-1"].value, {userId: 2});
```

#### memcached.cache(cacheObject)

 * `cacheObject`: **Object** The cache object to use

This method is not part of the memcached interface. It allows individual mock instances of Memcached to be configured to use a specific cache object instead of the default global cache.

This allows you to write code like:

```javascript
var memcachedA = new Memcached('192.168.0.1:11211');
var memcachedB = new Memcached('192.168.0.2:11211');
var memcachedC = new Memcached('192.168.0.2:11211');

var cache1 = {};
var cache2 = {};

memcachedA.cache(cache1); // set the cache object
memcachedB.cache(cache2);
memcachedC.cache(cache2);
```

This will set up `memcachedA` to use `cache1`, and `memcachedB` and `memcachedC` to use `cache2`, mimicking the behavior their server settings would normally have.

#### memcached.cachedump(server, slabid, limit, callback)

 * `server`: **String** Server to return the dump of
 * `slabid`: **Number** The slab id to dump
 * `limit`: **Number** The maximum number of results to return
 * `callback`: **Function** On completion callback

Provides a list of the keys in the cache. This mock method does return a listing of the actual keys, modeled as a single slab. All arguments besides `callback` are ignored.

#### memcached.cas(key, value, cas, ttl, callback)

 * `key`: **String** Name of the key
 * `value`: **Mixed** Value to associate with the key
 * `cas`: **String** The CAS id to compare
 * `ttl`: **Number** Expiration time for the key in seconds
 * `callback`: **Function** On completion callback

Update a mapping, but only if the CAS id of `key` matches `cas`. The CAS id of a key changes every time the key is updated.

#### memcached.decr(key, amount, callback)

 * `key`: **String** Name of the key
 * `amount`: **Number** Amount to decrement the value by
 * `callback`: **Function** On completion callback

Decrement a key's value by `amount`. This is only successful if the key already exists.

#### memcached.del(key, callback)

 * `key`: **String** Name of the key
 * `callback`: **Function** On completion callback

Remove a key from the cache.

#### memcached.end()

Terminate the server connection. This method has no effect.

#### memcached.flush(callback)

 * `callback`: **Function** On completion callback

Flush all keys from the cache.

#### memcached.get(key, callback)

 * `key`: **String** Name of the key
 * `callback`: **Function** On completion callback

Retrieve the value associated with `key`. If `key` is an array, this will automatically perform a `getMulti` call instead.

#### memcached.gets(key, callback)

 * `key`: **String** Name of the key
 * `callback`: **Function** On completion callback

Retrieve the value associated with `key` and its CAS id.

#### memcached.getMulti(keys, callback)

 * `keys`: **Array** Array of key names
 * `callback`: **Function** On completion callback

Retrieve the value associated with multiple keys in a single call.

#### memcached.incr(key, amount, callback)

 * `key`: **String** Name of the key
 * `amount`: **Number** Amount to increment the value by
 * `callback`: **Function** On completion callback

Increment a key's value by `amount`. This is only successful if the key already exists.

#### memcached.items(callback)

 * `callback`: **Function** On completion callback

Obtain information about items stored in the server. This returns correct information about the number of items contained in the cache. All other information is stub data.

#### memcached.prepend(key, value, callback)

 * `key`: **String** Name of the key
 * `value`: **Mixed** The value to prepend
 * `callback`: **Function** On completion callback

Prepend data to an existing key's value. The key must already exist in the cache.

#### memcached.replace(key, value, ttl, callback)

 * `key`: **String** Name of the key
 * `value`: **Mixed** New value to associate with the key
 * `ttl`: **Number** Expiration time for the key in seconds
 * `callback`: **Function** On completion callback

Replace the existing value of `key` with `value`. This is only successful if `key` already exists in the cache.

#### memcached.set(key, value, ttl, callback)

 * `key`: **String** Name of the key
 * `value`: **Mixed** Value to associate with the key
 * `ttl`: **Number** Expiration time for the key in seconds
 * `callback`: **Function** On completion callback

Set the value associated with `key` in the cache. This works whether the key already exists in the cache or not.

#### memcached.settings(callback)

 * `callback`: **Function** On completion callback

Retrieve server settings. This returns stub data for each server given in the constructor.

#### memcached.slabs(callback)

 * `callback`: **Function** On completion callback

Retrieve server slab information. This returns stub data showing one slab for each server given in the constructor.

#### memcached.stats(callback)

 * `callback`: **Function** On completion callback

Retrieve server stats. This returns stub data for each server given in the constructor.

#### version(callback)

 * `callback`: **Function** On completion callback

Retrieve server version. This returns stub data for each server given in the constructor. The current version of the module reports itself as version 1.4.20.
