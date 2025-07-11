# NearMyPostcode

A privacy-focussed Javascript library for converting UK postcodes to lat/long GPS coordinates and sorting locations by distance.

# Principles

NearMyPostcode (NMP) lets you provide a "store locator" feature (or similar) on your website that respects your user's privacy.

NMP works entirely offline. Once the data file (approx 5.5MB) is downloaded to the user's browser, they can completely disconnect from the internet and sill be able to look up their postcode and find things near their postcode.

When using NMP, you are encouraged to serve the javascript file from your own web server, and also serve the postcode data file from your own server. This minimises the number of requests the user agent needs to make to other services, and thus benfits the user's privacy further.

Although it is possible, you are discouraged from using this library to host your own postcode lookup API. The code is designed to be plain browser-friendly javascript because it is supposed to be used in the browser for privacy reasons.

# Getting started

1. Download `nearmypostcode.min.js` and `postcodes.pack` from the latest release
2. Put these files somewhere on your web server
3. Load NMP on your page, and use it to look up a postcode and sort some landmarks

```html
<script src="/nearmypostcode.js"></script>
...
<script>
    async function initNMP(){
        try{
            // Load NMP
            const nmp = await NearMyPostcode("/postcodes.pack");
            // (at this point you would normally enable your search UI, but this is just a short example)
            const [cpostcode, [long,lat]] = nmp.lookup_postcode("sw1a 2aa");
            console.log(cpostcode); // Canonical postcode
            console.log(long, lat); // Coordinates
        }
        catch (e){
            console.error(e);
        }
    }
    initNMP();
</script>
```

# Postcode updates

The postcode.pack files in the releases are derived from the ONS postcode database, which is updated every three months.

When an update is available, you can generate the postcodes.pack file for yourself from the ONS file by using the packing utility provided in this repository, or you can wait for the next release of NMP.

# Examples

For a more complete example of initialisation, see `example.html` - live demo here

For an example of using NMP to sort landmarks by distance, see `aa_box_demo.html` - live demo here

# Documentation

## Initialisation

```js
NearMyPostcode(url)
```

The function `NearMyPostcode` takes the URL for the postcodes.pack file, and returns a promise that resolves to an instance of NearMyPostcode

## NearMyPostcode object


### distance_between()

Function `distance_between(a,b)`

Return type `number`

Args:

- `a`: the first point (`[long, lat]`)
- `b`: the second point (`[long, lat]`)

Haversine distance between points `a` and `b` in kilometres.

## format_postcode()

Fucntion `format_postcode(postcode)`

Return type `string`

Args:

- `postcode` a string containing a UK postcode

Formats a postcode in to the canonical 7 character string format. The input postcode can use any case for letters, and may have spaces at any point. The resulting postcode will be all upper case. The Inward code (last three chars) will be aligned to the right of the string. The Outward code (everything exceptht Inward code) will be aligned to the left of the string. Padding spaces will be added between the Outward and Inward codes if required to make the postcode exactly 7 characters long.

### lookup_postcode()

Function `lookup_postcode(postcode)`

Return type `[string, [number, number]]`

Throws `Error(E_FORMAT)` or `Error(E_NOTFOUND)`

Args:
 - `postcode`: a UK postcode as a string

This function takes a postcode (that may or may not be in canonical format) and searches for it in the postcode data file provided when this NearMyPostcode object was created. It returns the canonical form of the postcode, and the latitude and longitude, or throws an error.

### sort_by_distance()

Function `sort_by_distance(items, point, coordsfunc)`

Return type `list of Object`

Args:

- `items`: a list of Objects to sort
- `point`: a GPS coordinate pair in the form `[long, lat]`
- `coordsfunc`: a function that takes an item from the items list and returns a GPS coordinate pair in the form `[long, lat]`

This function sorts a list of items by their distance to point. Coordsfunc must be a function that can take any item in the list and return the coordinates for them.

The result is a sorted list of wrappers around the items in the input list. Each one has this form:

```json
{
    item: {... the input item ...},
    distance: 123
}
```

where distance is the distance to the item from `point` in kilometres.

### Errors

Various functions can return these error values:

`E_FORMAT` - Postcode format is not recognised.
`E_NOTFOUND` - Postcode was not found in the data file provided.

