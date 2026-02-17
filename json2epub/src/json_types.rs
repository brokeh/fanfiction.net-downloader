use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize, Debug)]
pub struct Author {
    pub name: String,
    pub link: String,
}

#[derive(Deserialize, Serialize, Debug)]
pub struct Metadata {
    pub category: Vec<String>,
    pub rating: String,
    pub language: Option<String>,
    pub genre: Option<String>,
    pub characters: Option<String>,
    pub chapters: Option<String>,
    pub words: Option<String>,
    pub status: Option<String>,
    pub reviews: Option<String>,
    pub favs: Option<String>,
    pub follows: Option<String>,
}

#[derive(Deserialize, Serialize, Debug)]
pub struct Chapter {
    pub num: u32,
    pub title: String,
    pub url: String,
    pub contents: String,
    pub error: Option<String>,
}

#[derive(Deserialize, Serialize, Debug)]
pub struct Book {
    pub id: String,
    pub source: String,
    pub title: String,
    pub blurb: String,
    pub author: Author,
    pub metadata: Metadata,
    pub updated_time: Option<u32>,
    pub created_time: u32,
    pub download_time: u32,
    pub chapters: Vec<Chapter>,
}
