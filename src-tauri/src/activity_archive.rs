//! Explicit, bounded retirement of proven-complete v2 activities. No cleanup of
//! arbitrary history, scratch, models, receipts or sentinel files. All writers must
//! cooperate with the admission gate; the ledger directory must remain trusted.
use super::{Mode, Record};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs, path::Path};
#[derive(Debug, Serialize)]
pub(crate) struct Item {
    pub activity: String,
    pub status: String,
    pub detail: Option<String>,
}
fn item(id: &str, status: &str, detail: Option<String>) -> Item {
    Item {
        activity: id.into(),
        status: status.into(),
        detail,
    }
}
fn exists(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}
fn classify(id: &str, e: String) -> Item {
    let status = if e.starts_with("BUSY:") {
        "busy"
    } else if e.starts_with("INVALID:") {
        "invalid"
    } else {
        "io-error"
    };
    item(id, status, Some(e))
}
fn bound(rec: &Record, id: &str) -> Result<(), String> {
    if rec.activity != id {
        return Err("INVALID: archive identity mismatch".into());
    }
    Ok(())
}
fn one(ns: &Path, id: &str) -> Result<Item, String> {
    let active = ns.join(format!("activity-v2-{id}.json"));
    let archived = ns.join(format!("completed-v2-{id}.json"));
    if !exists(&active)? {
        if !exists(&archived)? {
            return Ok(item(id, "not-found", None));
        }
        let rec = super::read_record(&archived)?;
        bound(&rec, id)?;
        return Ok(item(
            id,
            if super::receipt_complete(ns, &rec)? {
                "already-archived"
            } else {
                "unproven"
            },
            None,
        ));
    }
    // Do not repair, merge or overwrite a pre-existing destination, even if equal.
    if exists(&archived)? {
        return Ok(item(id, "destination-exists", None));
    }
    let rec = super::read_record(&active)?;
    bound(&rec, id)?;
    if !super::receipt_complete(ns, &rec)? {
        return Ok(item(id, "unproven", None));
    }
    let mut held = Vec::new();
    for name in &rec.resources {
        held.push(super::lock(
            &ns.join(format!("file-{:x}.lease", Sha256::digest(name.as_bytes()))),
            Mode::Change,
        )?);
    }
    // Gate excludes participating admission/archive; exclusive resource handles
    // exclude older live holders too. Never substitute lock availability for proof.
    if super::read_record(&active)? != rec {
        return Err("INVALID: activity changed during archival".into());
    }
    if !super::receipt_complete(ns, &rec)? {
        return Ok(item(id, "unproven", None));
    }
    super::super::publish_new(&active, &archived)?; // atomic per record, NO_REPLACE
    Ok(item(id, "archived", None))
}
/// IDs are explicit: no unbounded directory walk and no deletion. Returns an item
/// for EVERY requested ID. Ok(batch) does NOT mean every item was archived. A batch
/// is not atomic; each move is. Gate/invalid-input failures occur before any move.
pub(crate) fn completed(ns: &Path, ids: &[&str]) -> Result<Vec<Item>, String> {
    if ids.is_empty() || ids.len() > 64 {
        return Err("INVALID: archive batch size".into());
    }
    let mut seen = std::collections::HashSet::new();
    for id in ids {
        if id.len() != 32
            || !id
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            || !seen.insert(*id)
        {
            return Err("INVALID: archive identity set".into());
        }
    }
    super::namespace(ns)?;
    let _gate = super::lock(&ns.join("admission-v2.lease"), Mode::Change)?;
    Ok(ids
        .iter()
        .map(|id| one(ns, id).unwrap_or_else(|e| classify(id, e)))
        .collect())
}
