//! Explicit, supervised activation for the isolated preview profile.
//! Automatic reveal remains disabled; this predicate is intentionally pure.
pub fn manual_activation_allowed(isolated: bool, marker: Option<&str>) -> bool {
    isolated && marker == Some("1")
}

#[cfg(test)]
mod tests {
    use super::manual_activation_allowed;
    #[test]
    fn production_and_missing_marker_are_denied() {
        assert!(!manual_activation_allowed(false, Some("1")));
        assert!(!manual_activation_allowed(true, None));
        assert!(!manual_activation_allowed(true, Some("0")));
        assert!(!manual_activation_allowed(true, Some("true")));
    }
    #[test]
    fn only_explicit_isolated_marker_is_admitted() {
        assert!(manual_activation_allowed(true, Some("1")));
    }
}
