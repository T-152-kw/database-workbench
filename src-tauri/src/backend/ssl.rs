use crate::backend::models::ConnectionProfile;
use mysql::{ClientIdentity, OptsBuilder, SslOpts};
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SslMode {
    Disabled,
    Preferred,
    Required,
    VerifyCa,
    VerifyIdentity,
}

pub(crate) fn parse_ssl_mode(value: Option<&str>) -> SslMode {
    match value
        .unwrap_or("preferred")
        .trim()
        .to_ascii_lowercase()
        .replace('_', "-")
        .as_str()
    {
        "disabled" => SslMode::Disabled,
        "required" => SslMode::Required,
        "verify-ca" => SslMode::VerifyCa,
        "verify-identity" => SslMode::VerifyIdentity,
        _ => SslMode::Preferred,
    }
}

pub(crate) fn ssl_mode_to_session_value(mode: SslMode) -> &'static str {
    match mode {
        SslMode::Disabled => "DISABLED",
        SslMode::Preferred => "PREFERRED",
        SslMode::Required => "REQUIRED",
        SslMode::VerifyCa => "VERIFY_CA",
        SslMode::VerifyIdentity => "VERIFY_IDENTITY",
    }
}

pub(crate) fn apply_ssl_mode_to_builder(
    mut builder: OptsBuilder,
    profile: &ConnectionProfile,
) -> Result<OptsBuilder, String> {
    let mode = parse_ssl_mode(profile.ssl_mode.as_deref());

    match mode {
        SslMode::Disabled => {
            builder = builder.ssl_opts(None::<SslOpts>);
            Ok(builder)
        }
        SslMode::Preferred => {
            let ssl_opts = SslOpts::default()
                .with_danger_skip_domain_validation(true)
                .with_danger_accept_invalid_certs(true);
            Ok(builder.ssl_opts(Some(ssl_opts)))
        }
        SslMode::Required | SslMode::VerifyCa | SslMode::VerifyIdentity => {
            let ca_path = non_empty(profile.ssl_ca_path.as_deref());
            let cert_path = non_empty(profile.ssl_cert_path.as_deref());
            let key_path = non_empty(profile.ssl_key_path.as_deref());

            if matches!(mode, SslMode::VerifyCa | SslMode::VerifyIdentity) && ca_path.is_none() {
                return Err(
                    "SSL mode VERIFY_CA / VERIFY_IDENTITY requires an SSL CA certificate path"
                        .to_string(),
                );
            }

            if cert_path.is_some() ^ key_path.is_some() {
                return Err(
                    "SSL client certificate and SSL client key must be set together".to_string(),
                );
            }

            let mut ssl_opts = SslOpts::default();

            if let Some(path) = ca_path {
                ssl_opts = ssl_opts.with_root_cert_path(Some(PathBuf::from(path)));
            }

            if let (Some(cert), Some(key)) = (cert_path, key_path) {
                ssl_opts = ssl_opts.with_client_identity(Some(ClientIdentity::new(
                    PathBuf::from(cert),
                    PathBuf::from(key),
                )));
            }

            ssl_opts = match mode {
                SslMode::Required => {
                    if ca_path.is_some() {
                        ssl_opts.with_danger_skip_domain_validation(true)
                    } else {
                        ssl_opts
                            .with_danger_skip_domain_validation(true)
                            .with_danger_accept_invalid_certs(true)
                    }
                }
                SslMode::VerifyCa => ssl_opts.with_danger_skip_domain_validation(true),
                SslMode::VerifyIdentity => ssl_opts,
                SslMode::Disabled | SslMode::Preferred => ssl_opts,
            };

            Ok(builder.ssl_opts(Some(ssl_opts)))
        }
    }
}

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.and_then(|v| {
        let trimmed = v.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}
