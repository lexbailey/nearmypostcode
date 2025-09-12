#![allow(non_upper_case_globals)]
#![allow(non_snake_case)]
/*

Program that converts the postcode database .csv file from the Office for National Statistics (ONS)
in to a packed binary format that is much more compact and quick to search. The packed format can
be read using the javascript library provided.

*/
use std::process::ExitCode;
use time::{Date, UtcDateTime, Time};
use std::fs::OpenOptions;
use std::io::{Write,Seek};
use std::fmt::Display;
use std::fmt::Formatter;
use std::num::ParseFloatError;
use std::collections::HashMap;
use clap::{arg, command};

#[derive(Debug)]
pub enum PostcodeError{
    IOError(std::io::Error),
    InputMalformed(),
    InvalidFormat(),
    NotFound(),
}

#[derive(Debug,Clone,Copy)]
struct Point{
    x: f64,
    y: f64,
}

#[derive(Debug, Clone)]
struct PostcodeInfo{
    postcode: String,
    location: Point,
}

impl Display for PostcodeError{
    fn fmt(&self, f: &mut Formatter<'_>) -> Result<(), std::fmt::Error> {
        use PostcodeError::*;
        match self{
            IOError(e) => write!(f,"Error reading or writing postcode file: {e}"),
            InputMalformed() => write!(f, "Input file is not well formed"),
            InvalidFormat() => write!(f, "Postcode format not recognised"),
            NotFound() => write!(f, "Postcode is well-formed, but not known"),
        }
    }
}

impl From<std::io::Error> for PostcodeError{
    fn from(e: std::io::Error) -> Self { PostcodeError::IOError(e) }
}

impl From<ParseFloatError> for PostcodeError{
    fn from(_: ParseFloatError) -> Self { PostcodeError::InputMalformed() }
}

pub fn pack_code(code: &str) -> Result<[u8;3], PostcodeError>{
    if code.len() < 7{
        return Err(PostcodeError::InvalidFormat());
    }

    let mut chars = code.as_bytes().iter();

    fn encode_AZ(x:u8) -> Result<u32, PostcodeError> {
        if x >= b'A' && x <= b'Z'{
            Ok((x-b'A') as u32)
        }
        else {
            Err(PostcodeError::InvalidFormat())
        }
    }

    fn encode_09(x:u8) -> Result<u32, PostcodeError> {
        if x >= b'0' && x <= b'9'{
            Ok((x-b'0') as u32)
        }
        else {
            Err(PostcodeError::InvalidFormat())
        }
    }

    fn encode_AZ09(x:u8) -> Result<u32, PostcodeError> {
        encode_AZ(x).or_else(|_|Ok(encode_09(x)?+26))
    }

    fn encode_AZ09_space(x:u8) -> Result<u32, PostcodeError> {
        if x == b' '{ Ok(36) } else{ encode_AZ(x).or_else(|_|Ok(encode_09(x)?+26)) }
    }

    // Skip the first two chars
    let _a = encode_AZ(*chars.next().unwrap())?;
    let _b = encode_AZ09(*chars.next().unwrap())?;

    // Encode the rest
    let c = 26*26*10*37*encode_AZ09_space(*chars.next().unwrap())?;
    let d = 26*26*10*encode_AZ09_space(*chars.next().unwrap())?;

    let e = 26*26*encode_09(*chars.next().unwrap())?;
    let f = 26*encode_AZ(*chars.next().unwrap())?;
    let g = encode_AZ(*chars.next().unwrap())?;
    let encoded = c + d + e + f + g;
    assert!(encoded < 2_u32.pow(24));
    let encoded = encoded.to_le_bytes();
    Ok([
        encoded[0],
        encoded[1],
        encoded[2]
    ])
}


fn field_id(name: &str, headers: &Vec<&str>) -> Result<usize, PostcodeError>{
    match headers.iter().position(|n|*n==name) {
        Some(n) => Ok(n),
        None => Err(PostcodeError::InputMalformed()),
    }
}

fn parse_date(d: Option<&str>) -> Option<Date> {
    let d = d?;
    if d.len()<6 {
        None
    }
    else{
        let y = d[0..4].parse().ok()?;
        let m:time::Month = d[4..6].parse::<u8>().ok()?.try_into().ok()?;
        let date = Date::from_calendar_date(y,m.into(),1);
        Some(date.ok()?)
    }
}

fn read_postcodes(path: &str, exclude: &Vec<&str>) -> Result<(Vec<PostcodeInfo>,Point,Point,usize,usize,usize,u64), PostcodeError> {
    let file = OpenOptions::new().read(true).open(path)?;
    let mut pclist = Vec::new();
    let mut postcodes = csv::Reader::from_reader(file);
    let headers = postcodes.headers();
    if headers.is_err(){
        return Err(PostcodeError::InputMalformed());
    }
    let headers: Vec<&str> = headers.unwrap().iter().collect();
    let id_postcode = field_id("pcd", &headers).or(field_id("pcd7", &headers))?;
    let id_lat = field_id("lat", &headers)?;
    let id_long = field_id("long", &headers)?;
    let id_date_intr = field_id("dointr", &headers)?;
    let id_date_term  = field_id("doterm", &headers)?;

    let mut minlat = 9999.0f64;
    let mut maxlat = -9999.0f64;
    let mut minlong = 9999.0f64;
    let mut maxlong = -9999.0f64;

    let mut total = 0;
    let mut num_terminated = 0;
    let mut num_excluded = 0;

    let mut last_update = Date::from_ordinal_date(1970,1).unwrap();

    'pcloop: for line in postcodes.records() {
        if line.is_err(){
            return Err(PostcodeError::InputMalformed());
        }
        total += 1;
        let line = line.unwrap();
        let postcode = line.get(id_postcode);
        if postcode.is_none(){
            continue;
        }
        let postcode = postcode.unwrap().to_string();
        let introduced = parse_date(line.get(id_date_intr));
        let terminated = parse_date(line.get(id_date_term));
        let is_current = match (introduced, terminated) {
            (Some(_), None) => true,
            _ => false,
        };
        if !is_current{
            num_terminated += 1;
            continue;
        }
        let lat = line.get(id_lat);
        if lat.is_none(){
            continue;
        }
        let lat: f64 = lat.unwrap().parse().unwrap();
        if lat > 99.0{
            continue; // no location known
        }
        let long = line.get(id_long);
        if long.is_none(){
            continue;
        }
        let long: f64 = long.unwrap().parse().unwrap();
        let location = Point{x:long, y:lat};

        for prefix in exclude{
            if postcode.starts_with(prefix){
                num_excluded += 1;
                continue 'pcloop;
            }
        }

        let introduced = introduced.unwrap();
        if introduced > last_update{
            last_update = introduced;
        }

        minlat = minlat.min(lat);
        maxlat = maxlat.max(lat);
        minlong = minlong.min(long);
        maxlong = maxlong.max(long);
        
        pclist.push(PostcodeInfo{
            postcode,
            location,
        });
    }
    let skipped = total - pclist.len();
    let unixtime = UtcDateTime::new(last_update, Time::from_hms(0,0,0).unwrap()).unix_timestamp() as u64;
    Ok((
        pclist, // Postcodes
        Point{x:minlong, y:minlat}, // Lower left corner of bounding box
        Point{x:maxlong, y:maxlat}, // Upper right corner of bounding box
        skipped, // Number of postcodes skipped
        num_terminated, // number of postcodes terminated
        num_excluded, // number of postcodes terminated
        unixtime, // date of last update
    ))
}


fn calc_ll(minll: Point, maxll: Point, ll: Point) -> (u16,u16){
    let latrange = maxll.y - minll.y;
    let longrange = maxll.x - minll.x;
    let lat = (((ll.y-minll.y)/latrange)*65535.0).round() as u16;
    let long = (((ll.x-minll.x)/longrange)*65535.0).round() as u16;
    (long,lat)
}

enum DeltaPacked{
    Absolute([u8;8]),
    DeltaP([u8;5]),
    DeltaLL([u8;6]),
    DeltaPLL([u8;3]),
}

impl DeltaPacked{
    fn write_to_file<W:Write>(&self, mut f:W) -> std::io::Result<usize>{
        use DeltaPacked::*;
        match self{
            Absolute(a) => {f.write(a)},
            DeltaP(a) => {f.write(a)},
            DeltaLL(a) => {f.write(a)},
            DeltaPLL(a) => {f.write(a)},
        }
    }

    fn len(&self) -> usize{
        use DeltaPacked::*;
        match self{
            Absolute(_) => 8,
            DeltaP(_) => 5,
            DeltaLL(_) => 6,
            DeltaPLL(_) => 3,
        }
    }
}

fn pack_postcodes(postcodes: &Vec<PostcodeInfo>, minll: Point, maxll:Point) -> Result<Vec<DeltaPacked>, PostcodeError> {
    let mut packed_codes = Vec::new();
    let mut last_code:u32 = 0;
    let mut last_lat:i32 = 0;
    let mut last_long:i32 = 0;
    let mut last_prefix = "  ".to_string();
    for p in postcodes{
        let this_prefix = &p.postcode[0..2];
        if this_prefix != last_prefix{
            // Any time the prefix changes, reset the previous code state.
            // This is important because the decoder skips to the start of
            // a prefix block as the first step, so it will still have the
            // initial state at this point.
            last_code = 0;
            last_lat = 0;
            last_long = 0;
            last_prefix = this_prefix.to_string();
        }
        let c = pack_code(&p.postcode)?;
        let code_number = u32::from_le_bytes([c[0],c[1],c[2],0]);
        let can_delta_encode_pc = {
            if last_code > code_number{
                // List is probably not sorted, inefficient
                false
            }
            else{
                (code_number - last_code) <= 64
            }
        };
        let (long,lat) = calc_ll(minll, maxll, p.location);
        let dlong = (long as i32) - last_long;
        let dlat = (lat as i32) - last_lat;
        let can_delta_encode_ll: bool = {
            let can_long = dlong >= -128 && dlong <= 127;
            let can_lat = dlat >= -128 && dlat <= 127;
            can_long && can_lat
        };
        let latb = lat.to_le_bytes();
        let longb = long.to_le_bytes();
        let ll = [latb[0],latb[1],longb[0],longb[1]];

        match (can_delta_encode_pc, can_delta_encode_ll){
            (false,false) => {
                let mut packed: [u8;8] = [0;8];
                packed[0] = 0x00;
                packed[1] = c[0];
                packed[2] = c[1];
                packed[3] = c[2];
                packed[4] = ll[0];
                packed[5] = ll[1];
                packed[6] = ll[2];
                packed[7] = ll[3];
                packed_codes.push(DeltaPacked::Absolute(packed));
            },
            (true,false) => {
                let mut packed: [u8;5] = [0;5];
                packed[0] = 0x80 + ((code_number - last_code - 1) as u8).to_le_bytes()[0];
                packed[1] = ll[0];
                packed[2] = ll[1];
                packed[3] = ll[2];
                packed[4] = ll[3];
                packed_codes.push(DeltaPacked::DeltaP(packed));
            },
            (false,true) => {
                let mut packed: [u8;6] = [0;6];
                packed[0] = 0x40;
                packed[1] = c[0];
                packed[2] = c[1];
                packed[3] = c[2];
                packed[4] = dlat.to_le_bytes()[0];
                packed[5] = dlong.to_le_bytes()[0];
                packed_codes.push(DeltaPacked::DeltaLL(packed));
            },
            (true,true) => {
                let mut packed: [u8;3] = [0;3];
                packed[0] = 0xc0 + ((code_number - last_code - 1) as u8).to_le_bytes()[0];
                packed[1] = dlat.to_le_bytes()[0];
                packed[2] = dlong.to_le_bytes()[0];
                packed_codes.push(DeltaPacked::DeltaPLL(packed));
            },
        }
        last_code = code_number;
        last_lat = lat as i32;
        last_long = long as i32;
    }
    Ok(packed_codes)
}

fn human(n: u64) -> String{
    let mut n: f64 = n as f64;
    const names: [&str;4] = [
        "Bytes",
        "KiB",
        "MiB",
        "GiB",
    ];
    let mut ni = 0;
    while ni < names.len()-1 && n > 1024.0{
        ni += 1;
        n /= 1024.0;
    }
    format!("{:.3} {}",n, names[ni])
}

fn do_postcode_repack(infilename: &str, outfilename: &str, exclude: &Vec<&str>) -> Result<(),PostcodeError>{
    println!("Reading postcodes...");
    let (mut postcodes, minll, maxll, skipped, terminated, excluded, last_update) = read_postcodes(infilename, exclude)?;
    println!("  File contained {} entries.", postcodes.len()+skipped);
    println!("    {} of these were skipped.", skipped);
    println!("      {} of the skips were for terminated postcodes.", terminated);
    println!("      {} of the skips were for excluded prefixes.", excluded);
    println!("  Will process {} postcodes in the bounding box from {},{} to {},{}", postcodes.len(), minll.x,minll.y, maxll.x,maxll.y);
    println!("Sorting postcode lists...");
    postcodes.sort_by(|a,b|a.postcode.cmp(&b.postcode));
    println!("Packing postcodes...");
    let packed_codes = pack_postcodes(&postcodes, minll, maxll)?;
    let mut outfile = OpenOptions::new().write(true).create(true).truncate(true).open(outfilename)?;
    println!("Writing packed postcodes to file...");

    /*
    File structure:
    (all numbers in little endian unless specified otherwise)
    
    Header, 16 bytes:

        magic:   4 bytes "UKPP" - magic number for "UK Postcode Pack"
        version: 4 bytes (u32)  - version number of the file format (this code generates version 1)
        date:    8 bytes (u64)  - a unix epoch that represents the release date of the ONS dataset that the file was generated from

    Boudning box extents, 4*8 = 32 bytes:

        minlong: 8 bytes (f64)
        maxlong: 8 bytes (f64)
        minlat:  8 bytes (f64)
        maxlat:  8 bytes (f64)
    
    Quick lookup table, 26*36*4 = 3744 bytes:

        list of 26*36 index values
            position: 4 bytes (u32, byte offset into postcode data list)
        last_pos: 4 bytes (u32, conveniently is just above last entry in the table)
        
    Postcode data, variable length (3 to 8 bytes per postcode):
    
        list of postcodes:
            format:   1 bytes (bitfield)
                postcode_is_delta: 1 bit (flag indicating if postcode is delta-encoded)
                latlong_is_delta:  1 bit (flag indicating if lat/long is delta-encoded)
                postcode_delta:    6 bits (u6 number to add to previous postcode to calculate this postcode, or unused if not postcode_is_delta)
            postcode: 0 or 3 bytes (custom encoding, present only if not postcode_is_delta)
            longlat:  2 or 4 bytes (2 x i8 if latlong_is_delta, or 2 x u16 otherwise)

    */

    // Header...
    outfile.write(b"UKPP")?; // magic number is 1347439445

    // version 1 of file format
    const version: u32 = 1;
    outfile.write(&version.to_le_bytes())?;

    // data update date
    outfile.write(&last_update.to_le_bytes())?;

    // bounding box extents
    let minlong = minll.x;
    let maxlong = maxll.x;
    let minlat = minll.y;
    let maxlat = maxll.y;
    outfile.write(&minlong.to_le_bytes())?;
    outfile.write(&maxlong.to_le_bytes())?;
    outfile.write(&minlat.to_le_bytes())?;
    outfile.write(&maxlat.to_le_bytes())?;

    let mut lut: HashMap<String, u32> = HashMap::new();

    // Build and write the table
    let mut last_prefix = String::new();
    let mut pos = 0;
    for (postcode, packed_code) in postcodes.iter().zip(&packed_codes){
        let this_prefix = postcode.postcode[0..2].to_string();
        if this_prefix != last_prefix{
            lut.insert(this_prefix.clone(), pos as u32);
            last_prefix = this_prefix;
        }
        pos += packed_code.len();
    }

    // Build the table in reverse to be able to calculate the offsets
    let mut lastpos = pos as u32;
    for c1 in (0..26).rev(){
        let s1 = b'A'+c1;
        for c2 in (0..36).rev(){
            let s2 = if c2 > 9{ b'A'+c2-10 } else { b'0'+c2};
            let s_bytes = [s1,s2];
            let s = std::str::from_utf8(&s_bytes).unwrap().to_string();
            let pos = lut.get(&s).copied().unwrap_or(lastpos);
            lastpos = pos;
            lut.insert(s, pos);
        }
    }

    // Write it forwards, since that's the way the lookup will happen
    for c1 in 0..26{
        let s1 = b'A'+c1;
        for c2 in 0..36{
            let s2 = if c2 > 9{ b'A'+c2-10 } else { b'0'+c2};
            let s_bytes = [s1,s2];
            let s = std::str::from_utf8(&s_bytes).unwrap().to_string();
            let pos = lut.get(&s).unwrap();
            outfile.write(&pos.to_le_bytes())?;
        }
    }

    // One extra element after end, total bytes
    outfile.write(&lastpos.to_le_bytes())?;
    for p in packed_codes.iter(){
        p.write_to_file(&outfile)?;
    }

    if let Ok(l) = outfile.stream_position() {
        println!("  Total file size: {}", human(l));
    }
    else{
        println!("  Non-fatal error: unable to determine final file size");
    }
    Ok(())
}

fn main() -> ExitCode {
    let matches = command!()
        .arg(arg!(<input> "Input file name (path to ONS Postcode Database CSV file)"))
        .arg(arg!(<output> "Output file name"))
        .arg(arg!(--exclude <prefix> ... "Exclude a group of postcodes by its prefix (can be specified multiple times)"))
        .get_matches();

    let infilename = &matches.get_one::<String>("input").expect("No input file");
    let outfilename = &matches.get_one::<String>("output").expect("No output file");
    let exclude = if let Some(e) = matches.get_many::<String>("exclude"){
        e.map(|a|a.as_str()).collect()
    } else {
        Vec::new()
    };

    match do_postcode_repack(infilename, outfilename, &exclude){
        Err(e) => { eprintln!("Error repacking postcodes: {e}"); ExitCode::FAILURE }
        Ok(_) => { println!("Complete"); ExitCode::SUCCESS }
    }
}

