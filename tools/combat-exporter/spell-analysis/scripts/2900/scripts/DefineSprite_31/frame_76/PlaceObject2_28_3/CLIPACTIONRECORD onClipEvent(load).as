onClipEvent(load){
   sz = 60 + 20 * ((_parent._parent.level - 1) % 3);
   _xscale = sz;
   _yscale = sz;
   i = 1;
   while(i < 6 + 7 * ((_parent._parent.level - 1) % 3))
   {
      this.attachMovie("feux","feux" + i,i);
      i++;
   }
}
