import {tags} from '@lezer/highlight';
// Comments are syntax nodes, so decorations and completion need not rescan a
// whole document, and code spans/fences retain Markdown's parser precedence.
export const obsidianComments = {
  defineNodes:[{name:'ObsidianComment',style:tags.comment},{name:'ObsidianCommentBlock',block:true,style:tags.comment}],
  parseInline:[{name:'ObsidianComment',before:'Emphasis',parse(cx,next,pos){
    if(next!==37 || cx.char(pos+1)!==37)return -1;
    const end=cx.text.indexOf('%%',pos-cx.offset+2);
    if(end<0)return -1;
    return cx.addElement(cx.elt('ObsidianComment',pos,cx.offset+end+2));
  }}],
  parseBlock:[{name:'ObsidianCommentBlock',before:'FencedCode',parse(cx,line){
    const text=line.text.slice(line.pos);
    if(!text.startsWith('%%') || text.indexOf('%%',2)>=0)return false;
    const from=cx.lineStart+line.pos;
    let end=cx.lineStart+line.text.length;
    while(cx.nextLine()) {
      const at=line.text.indexOf('%%',line.pos);
      end=cx.lineStart+line.text.length;
      if(at>=0){cx.nextLine();break;}
    }
    cx.addElement(cx.elt('ObsidianCommentBlock',from,end));return true;
  }}],
};
