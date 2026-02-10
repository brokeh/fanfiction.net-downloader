
use std::fs;
use std::fs::File;
use json2epub::build_epub_to;
use std::env;

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        println!("Usage: {} <input.json> [output.epub]", args[0]);
        return;
    }
    let output_filename: &str = if args.len() < 3 { "output.epub" } else { args[2].as_str() };

    let book_json = match fs::read_to_string(&args[1]) {
        Ok(s) => s,
        Err(err) => {
            println!("Failed to open {} for reading: {}", args[1], err);
            return;
        }
    };
    let mut output_file = match File::create(&output_filename) {
        Ok(f) => f,
        Err(err) => {
            println!("Failed to open {} for writing: {}", output_filename, err);
            return;
        }
    };
    match build_epub_to(book_json.as_str(), &mut output_file) {
        Ok(_) => println!("Successfully wrote story to {}", output_filename),
        Err(err) => {
            println!("Failed to convert JSON to EPUB: {}", err);
            return;
        }
    };
}
