async function NearMyPostcode(datafile_url){
    let deltapack;
    try{
        const response = await fetch(datafile_url);
        if (!response.ok){
            throw new Error(`Failed to fetch postcode data file (${datafile_url}): ${response.status}`);
        }
        deltapack = await response.arrayBuffer();
    }
    catch (err) {
        throw new Error(`Failed to fetch postcode data file (${datafile_url}): ${err.message}`);
    }

    // Parse the file header
    // Header, 16 bytes
    //
    //     magic:   4 bytes "UKPP" - magic number for "UK Postcode Pack"
    //     version: 4 bytes (u32)  - version number of the file format (this code generates version 1)
    //     date:    8 bytes (u64)  - a unix epoch that represents the release date of the ONS dataset that the file was generated from

       
    const magic = new Uint32Array(deltapack.slice(0,4))[0];
    if (magic != 1347439445){
        throw new Error("Postcode data file is not using a known format");
    }
    const version = new Uint32Array(deltapack.slice(4,8))[0];
    const max_version = 1; // This version of the library only supports version 1
    if (version > max_version){
        throw new Error(`Postcode data file uses format version ${version}. This NMP version only supports data formats up to ${max_version}. NMP needs to be updated.`);
    }

    const timestamp = new Uint32Array(deltapack.slice(8,16));
    const unixtime = BigInt(timestamp[0]) + (BigInt(timestamp[1]) * (2n**32n));
    const date = new Date(Number(unixtime*1000n));

    console.info(`nearmypostcode: Loaded postcode pack. File format version is ${version}. Last updated ${date.toDateString()}`);

    var nmp = Object();
    nmp.deltapack = deltapack.slice(16); // Discard the header, no longer needed

    nmp.date_last_updated = date;

    nmp.E_FORMAT = "Postcode format not recognised";
    nmp.E_NOTFOUND = "Postcode not found";

    nmp.pack_code = ((postcode) => {
        if (postcode.length != 7){
            throw new Error(nmp.E_FORMAT);
        }

        function ord(x){
            return x.charCodeAt(0);
        }

        function encode_AZ(x) {
            let code = ord(x);
            if (code >= ord('A') && code <= ord('Z')){
                return code - ord('A')
            }
            else {
                throw new Error(nmp.E_FORMAT);
            }
        }

        function encode_09(x) {
            let code = ord(x);
            if (code >= ord('0') && code <= ord('9')) {
                return code - ord('0');
            }
            else {
                throw new Error(nmp.E_FORMAT);
            }
        }

        function encode_AZ09(x) {
            try{
                return encode_AZ(x);
            }
            catch{
                return encode_09(x)+26;
            }
        }

        function encode_AZ09_space(x) {
            if (x == " "){
                return 36;
            }
            return encode_AZ09(x);
        }

        const [a,b,c,d,e,f,g] = postcode;

        // Encode the rest
        let c2 = 26*26*10*37*encode_AZ09_space(c);
        let d2 = 26*26*10*encode_AZ09_space(d);

        let e2 = 26*26*encode_09(e);
        let f2 = 26*encode_AZ(f);
        let g2 = encode_AZ(g);
        let encoded = c2 + d2 + e2 + f2 + g2;
        return encoded;
    });

    nmp.format_postcode = ((pc) => {
        // A UK postcode has two parts.
        // The first is the "outward code", and is 2, 3, or 4 characters long
        // The second is the "inward code", which is always 3 characters long
        //
        // The cannonical format for a postcode (at least for this database) is always 7 characters long where
        // the inward code always right-aligned and the outward code is always left aligned.
        // This means that if the outward code is shorter than 4 characters, then there will be spaces inserted
        // in to the string to make up the length.
        const VALID_CHARS = " abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        let chars = Array.from(pc);
        for (c of chars){
            if (!VALID_CHARS.includes(c)){
                throw new Error(nmp.E_FORMAT);
            }
        }
    
        let code = chars.filter((c)=>c!=" ").map((c)=>c.toUpperCase()).join("");
    
        // We should now have somewhere between 7 and 5 characters
        let numchars = code.length;
        if (numchars > 7 || numchars < 5){
            throw new Error(nmp.E_FORMAT);
        }
        // Now we extract the inward and outward codes
        let inward = code.slice(numchars-3,numchars);
        let outward = code.slice(0,numchars-3);
        // Generate enough padding
        let n_padding = 4 - outward.length;
        let padding = "  ".slice(0,n_padding);
        // Build the resulting postcode
        let canonical = outward + padding + inward;
        return canonical;
    })

    nmp.lookup_postcode = ((postcode)=>{
        // File structure:
        // (all numbers in little endian unless specified otherwise)
        // 
        // Header, 16 bytes (skipped by loader)
        //     (skipped)
        //
        // Bounding box extents, 4*8=32 bytes
        //
        //     minlong: 8 bytes (f64)
        //     maxlong: 8 bytes (f64)
        //     minlat:  8 bytes (f64)
        //     maxlat:  8 bytes (f64)
        // 
        // Quick lookup table, 26*36*4 = 3744 bytes:
        // 
        //     list of 26*36 offset values
        //         offset: 4 bytes (u32, offset in to postcode data)
        //     last_offset: 4 bytes (u32, conveniently placed at the end of the lookup table)
        //     
        // Postcode data, variable length (3 to 8 bytes per postcode):
        // 
        //     list of postcodes:
        //         format:   1 bytes (bitfield)
        //             postcode_is_delta: 1 bit (flag indicating if postcode is delta-encoded)
        //             latlong_is_delta:  1 bit (flag indicating if lat/long is delta-encoded)
        //             postcode_delta:    6 bits (u6 number to add to previous postcode to calculate this postcode, or unused if not postcode_is_delta)
        //         postcode: 0 or 3 bytes (custom encoding, present only if not postcode_is_delta)
        //         longlat:  2 or 4 bytes (2 x i8 if latlong_is_delta, or 2 x u16 otherwise)

        const pack = nmp.deltapack;

        // Calculate the encoded value of this postcode
        let cpostcode = nmp.format_postcode(postcode);
        let c_code = nmp.pack_code(cpostcode);
        let c = [
            c_code & 0xff,
            (c_code >> 8) & 0xff,
            (c_code >> 16) & 0xff,
        ];

        // Get the extents of the postcode bounding box
        const extents = new Float64Array(pack.slice(0,32));
        const [minlong,maxlong,minlat,maxlat] = extents;

        // Use the two character prefix to find the offsets in the offset lookup table
        const c1 = cpostcode.charCodeAt(0);
        const c2 = cpostcode.charCodeAt(1);
        const ord = (x)=>x.charCodeAt(0);
        const c2_i = (c2 < ord('A')? (c2 - ord('0')) : (10 + c2 - ord('A')));
        const lut_index = ((c1 - ord('A'))*36)+c2_i;
        const lpos = (8*4) + (lut_index * 4);
        const range = new Uint32Array(pack.slice(lpos,lpos+8));
        const [startpos, endpos] = range;

        // Scan the rest of the file from startpos to endpos looking for the postcode
        // (startpos is relative to the start of the postcode data, so calculate that offset first)
        const datastart = (8*4) + (4*26*36) + 4;
        var pos = startpos + datastart
        var last_code = 0;
        var last_lat = 0;
        var last_long = 0;
        while (pos < endpos + datastart){
            // Get the format of this postcode entry (each field delta encoded or not)
            const format = new Uint8Array(pack.slice(pos,pos+1))[0];
            pos += 1;
            const pc_is_delta = (format & 0x80) > 0;
            const ll_is_delta = (format & 0x40) > 0;
            // Calculate the postcode and lat/long by addition of the delta value or from absolute values
            // as specified in the format byte
            let this_code;
            if (pc_is_delta){
                // Postcode delta encoding is part of the format byte
                const delta = format & 0x3f;
                this_code = last_code + delta;
            }
            else{
                // Absolute postcode is three bytes long
                const [nc_a, nc_b, nc_c] = new Uint8Array(pack.slice(pos,pos+3));
                pos += 3;
                this_code = (nc_c << 16) + (nc_b << 8) + nc_a;
            }
            let long;
            let lat;
            if (ll_is_delta){
                // lat/long is delta encoded as a pair of signed 8 bit numbers
                const [dlat, dlong] = new Int8Array(pack.slice(pos,pos+2))
                pos += 2;
                long = last_long + dlong;
                lat = last_lat + dlat;
            }
            else{
                // Absolute lat/long is a pair of 16 bit unsigned numbers
                [lat, long] = new Uint16Array(pack.slice(pos,pos+4))
                pos += 4;
            }
            // Now ready to check if this code is a match
            if (this_code == c_code){
                // Calculate the real coordinates (the stored value is the fraction of the width or height of the bounding box)
                const lat2  = minlat +  ((maxlat -minlat )*(lat/65535.0));
                const long2 = minlong + ((maxlong-minlong)*(long/65535.0));
                return [cpostcode,[long2,lat2]];
            }
            last_code = this_code;
            last_lat = lat;
            last_long = long;
        }
        throw new Error(nmp.E_NOTFOUND);
    });

    nmp.distance_between = ((point_a,point_b)=>{
        toRad = (x)=> x * Math.PI / 180;

        const [lon1,lat1] = point_a;
        const [lon2,lat2] = point_b;
        const R = 6371;
        const x1 = lat2 - lat1;
        const dLat = toRad(x1);
        const x2 = lon2 - lon1;
        const dLon = toRad(x2)
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
          Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    });

    nmp.sort_by_distance = ((items, point, coordfunc)=>{
        var by_distance = items.map((i)=>{return{item:i,distance:nmp.distance_between(point, coordfunc(i))}});
        by_distance.sort((a,b)=>a.distance-b.distance);
        return by_distance;
    });

    return nmp;
}



