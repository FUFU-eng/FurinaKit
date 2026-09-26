/** More than one visible upload field means independent roles, never page-wide guessing. */
export function hasMultipleUploadFields():boolean{
 const fields=new Set<Element>();
 document.querySelectorAll<HTMLInputElement>('input[type="file"]:not([disabled])').forEach(input=>{
  const field=input.closest('[data-furinakit-file-field],[data-furinakit-dropzone]')||input.parentElement;
  if(field&&field.getClientRects().length)fields.add(field);
 });
 return fields.size>1;
}
