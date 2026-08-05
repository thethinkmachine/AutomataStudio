// ══════════════════════════════════════════════════════════════════
//  EXPORT FORMAT REGISTRY
// ══════════════════════════════════════════════════════════════════
// The shared table of export targets, kept in its own module so that the two
// files which populate it do not have to depend on each other.
//
// js/export-ui.js contributes the diagram/table/sample formats and owns the
// dialog; js/codegen.js contributes the code and test-suite formats. Previously
// the table was declared in export-ui.js and codegen.js reached across to it at
// load time, which made the pair mutually dependent and pinned their script
// order. Both now import this object and add to it.
//
// An entry is:
//   label    display name in the format list
//   group    heading it sits under ('Diagram', 'Code', 'Tests', ...)
//   ext      file extension used for the download
//   mime     download MIME type
//   blurb    one-line HTML explainer shown under the picker
//   options  option schema; types are 'check', 'select', 'number', 'text'
//   build    (ir, opts) => string, given the machine IR from export-core.js
const ExportFormats = {};
