use std::path::PathBuf;
use anyhow::Result;
use swf_spike::swf_doc::SwfDoc;

fn main() -> Result<()> {
    let path = PathBuf::from(std::env::args().nth(1).unwrap());
    let doc = SwfDoc::load(&path)?;
    let mut names: Vec<&String> = doc.by_name.keys().collect();
    names.sort();
    for n in names {
        println!("{}", n);
    }
    Ok(())
}
