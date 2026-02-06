onClipEvent(load){
   c = 0;
   while(c < 7)
   {
      this.attachMovie("pierres","pierres" + c,c);
      c++;
   }
}
