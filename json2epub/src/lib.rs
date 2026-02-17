use epub_builder::EpubBuilder;
use epub_builder::EpubContent;
use epub_builder::ReferenceType;
use epub_builder::ZipLibrary;

use minijinja::{Environment, context};

use chrono::DateTime;


use wasm_bindgen::prelude::{JsValue, wasm_bindgen};
use web_sys::{Blob, BlobPropertyBag};
use js_sys::Uint8Array;

use std::io;

mod json_types;


#[derive(thiserror::Error, Debug)]
pub enum Error {
    #[error("IO error: {0}")]
    IoError(std::io::Error),
    #[error("JSON error: {0}")]
    JsonError(serde_json::Error),
    #[error("{0}")]
    EpubError(epub_builder::Error),
    #[error("Jinja template error: {0:?}")]
    JinjaError(minijinja::Error),
}

impl From<std::io::Error> for Error {
    fn from(value: std::io::Error) -> Self {
        Self::IoError(value)
    }
}
impl From<serde_json::Error> for Error {
    fn from(value: serde_json::Error) -> Self {
        Self::JsonError(value)
    }
}
impl From<epub_builder::Error> for Error {
    fn from(value: epub_builder::Error) -> Self {
        Self::EpubError(value)
    }
}
impl From<minijinja::Error> for Error {
    fn from(value: minijinja::Error) -> Self {
        Self::JinjaError(value)
    }
}

impl From<Error> for JsValue {
    fn from(value: Error) -> Self {
        Self::from_str(value.to_string().as_str())
        // match value {
        //     Error::IoError(e) => e.into(),
        //     Error::JsonError(e) => e.into(),
        //     Error::EpubError(e) => e.into(),
        //     Error::JinjaError(e) => e.into(),
        // }
    }
}

pub type Result<T> = core::result::Result<T, Error>;

fn render_template(template_file: &str, jinja_env: &Environment) -> core::result::Result<String, minijinja::Error> {
    let template = jinja_env.get_template(template_file)?;
    template.render(context! { })
}

fn render_book_template(template_file: &str, jinja_env: &Environment, book: &json_types::Book) -> core::result::Result<String, minijinja::Error> {
    let template = jinja_env.get_template(template_file)?;
    template.render(context! { book => &book })
}

fn render_chapter_template(jinja_env: &Environment, book: &json_types::Book, chapter: &json_types::Chapter) -> core::result::Result<String, minijinja::Error> {
    let template = jinja_env.get_template("chapter.html.j2")?;
    template.render(context! { book => &book, chapter => &chapter })
}

fn format_epoch_time(epoch_seconds: i64, format: &str) -> Option<String> {
    if let Some(datetime_utc) = DateTime::from_timestamp(epoch_seconds, 0) {
        return Some(datetime_utc.format(format).to_string());
    }
    None
}

fn chapter_description(chapter: &json_types::Chapter, book: &json_types::Book) -> String {
    if book.chapters.len() == 1 && chapter.title.is_empty() {
        return book.title.clone();
    }
    if chapter.title.is_empty() {
        return format!("Chapter {}", chapter.num);
    }
    format!("Chapter {}: {}", chapter.num, chapter.title)
}
 
// Try to print Zip file to stdout
fn prepare_epub(jinja_env: &Environment, book: &json_types::Book) -> Result<EpubBuilder<ZipLibrary>> {
    // Create a new EpubBuilder using the zip library
    let mut builder = EpubBuilder::new(ZipLibrary::new()?)?;
    // Set some metadata
    builder
        .metadata("author", &book.author.name)?
        .metadata("title", &book.title)?
        // Set the stylesheet (create a "stylesheet.css" file in EPUB that is used by some generated files)
        .stylesheet(render_template("stylesheet.css.j2", jinja_env)?.as_bytes())?
        // Add a title page
        .add_resource("style/main.css", render_template("epub.css.j2", jinja_env)?.as_bytes(), "text/css")?
        .add_content(
            EpubContent::new("title.xhtml", render_book_template("cover.html.j2", jinja_env, book)?.as_bytes())
                .title("Title")
                .reftype(ReferenceType::TitlePage),
        )?
        // Generate a toc inside of the document, that will be part of the linear structure.
        .inline_toc();

    for chapter in &book.chapters {
        let content = render_chapter_template(jinja_env, book, chapter)?;
        builder.add_content(
            EpubContent::new(format!("chapter_{}.xhtml", chapter.num), content.as_bytes())
            .title(chapter_description(chapter, book))
            .reftype(ReferenceType::Text),
        )?;
    }

    Ok(builder)
}

pub fn build_epub_to<W: io::Write>(book_json: &str, to: W) -> Result<()> {
    let book = serde_json::from_str(book_json)?;

    let mut jinja_env = Environment::new();
    jinja_env.add_filter("format_epoch_time", format_epoch_time);
    minijinja_embed::load_templates!(&mut jinja_env);

    let builder = prepare_epub(&jinja_env, &book)?;
    builder.generate(to)?;
    Ok(())
}

fn vec_to_blob(vec: Vec<u8>) -> core::result::Result<Blob, JsValue> {
    let uint8_array = Uint8Array::from(&vec[..]);
    drop(vec);

    let parts = js_sys::Array::new();
    parts.push(&uint8_array);

    let blob_options = BlobPropertyBag::new();
    blob_options.set_type("application/octet-stream");

    Blob::new_with_u8_array_sequence_and_options(&parts, &blob_options)
}

#[wasm_bindgen]
pub fn build_epub(book_json: &str) -> core::result::Result<Blob, JsValue> {
    let mut buffer: Vec<u8> = Vec::new();
    build_epub_to(book_json, &mut buffer)?;
    vec_to_blob(buffer)
}
