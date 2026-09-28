const PAGE_INTRO_SELECTOR = [
  ':scope > .sectionhead',
  ':scope > .page-header',
  ':scope > .ops-pro-header',
  ':scope > .dashboard-hero',
  ':scope > .action-center-hero',
  ':scope > .workflow-hero',
  ':scope > .automation-hero',
  ':scope > .quality-hero',
  ':scope > .self-service-shell > .portal-header',
].join(',');

function normalizedLabel(value){
  return String(value||'').replace(/&/g,'and').replace(/\s+/g,' ').trim().toLowerCase();
}

function repeatsPageTitle(heading,pageTitle){
  const headingText=normalizedLabel(heading);
  const titleText=normalizedLabel(pageTitle);
  if(!headingText||!titleText) return false;
  if(headingText===titleText||headingText.endsWith(` ${titleText}`)||titleText.endsWith(` ${headingText}`)) return true;
  const titleTerms=titleText.split(/[^a-z0-9]+/).filter(term=>term.length>=5);
  const headingTerms=new Set(headingText.split(/[^a-z0-9]+/));
  return titleTerms.some(term=>headingTerms.has(term));
}

export function compactRedundantPageIntros(root,pageTitle){
  if(!root||!pageTitle) return 0;
  let compacted=0;
  root.querySelectorAll(PAGE_INTRO_SELECTOR).forEach(header=>{
    if(header.dataset.pageIntroChecked==='true') return;
    header.dataset.pageIntroChecked='true';
    const heading=header.querySelector('h1,h2');
    if(!heading||!repeatsPageTitle(heading.textContent,pageTitle)) return;

    const titleBlock=heading.parentElement;
    if(titleBlock&&titleBlock!==header) titleBlock.remove();
    else {
      header.querySelector(':scope > .eyebrow')?.remove();
      header.querySelector(':scope > p')?.remove();
      heading.remove();
    }

    const interactive='button,a[href],input,select,textarea';
    Array.from(header.children).forEach(child=>{
      if(!child.matches(interactive)&&!child.querySelector(interactive)) child.remove();
    });
    if(!header.querySelector(interactive)) header.remove();
    else header.classList.add('page-actions-only');
    compacted++;
  });
  return compacted;
}
