// Some tests execute the compiled CommonJS build in functions/lib (the code that
// is actually deployed). That output has no declarations, so these pattern
// modules give each compiled file the types of the source it was built from.
declare module '*/functions/lib/functions/src/organizer/automation.js' {
  export * from '@/functions/src/organizer/automation';
}
declare module '*/functions/lib/functions/src/organizer/catalog.js' {
  export * from '@/functions/src/organizer/catalog';
}
declare module '*/functions/lib/functions/src/organizer/drive.js' {
  export * from '@/functions/src/organizer/drive';
}
declare module '*/functions/lib/functions/src/organizer/interpretation.js' {
  export * from '@/functions/src/organizer/interpretation';
}
declare module '*/functions/lib/functions/src/organizer/planning.js' {
  export * from '@/functions/src/organizer/planning';
}
declare module '*/functions/lib/functions/src/organizer/vision.js' {
  export * from '@/functions/src/organizer/vision';
}
declare module '*/functions/lib/functions/src/organizer/baseCodeVision.js' {
  export * from '@/functions/src/organizer/baseCodeVision';
}
declare module '*/functions/lib/functions/src/catalog/organizerBinding.js' {
  export * from '@/functions/src/catalog/organizerBinding';
}
declare module '*/functions/lib/functions/src/organizer/baseCode.js' {
  export * from '@/functions/src/organizer/baseCode';
}
