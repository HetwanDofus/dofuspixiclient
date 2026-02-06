onClipEvent(enterFrame){
   if(c < inte)
   {
      this.attachMovie("duplic","duplic" + c,c);
      this.attachMovie("duplic","duplic" + c,c + 100);
      c++;
   }
   else
   {
      if(lok != 1)
      {
         this.end();
         lok = 1;
      }
      if(t2++ == 20)
      {
         _parent.removeMovieClip();
      }
   }
}
