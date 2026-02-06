onClipEvent(load){
   c2 = 100;
   n = 14 - 3 * _parent._parent.params.fire - 3 * _parent._parent.params.water - 3 * _parent._parent.params.earth - 3 * _parent._parent.params.air;
   if(_parent._parent.params.fire == 1)
   {
      c = c2;
      while(c < c2 + n)
      {
         this.attachMovie("part_f","part_f" + c,c);
         c++;
      }
      c2++;
   }
   if(_parent._parent.params.water == 1)
   {
      c = c2;
      while(c < c2 + n)
      {
         this.attachMovie("part_w","part_w" + c,c);
         c++;
      }
      c2++;
   }
   if(_parent._parent.params.earth == 1)
   {
      c = c2;
      while(c < c2 + n)
      {
         this.attachMovie("part_e","part_e" + c,c);
         c++;
      }
      c2++;
   }
   if(_parent._parent.params.air == 1)
   {
      c = c2;
      while(c < c2 + n)
      {
         this.attachMovie("part_a","part_a" + c,c);
         c++;
      }
      c2++;
   }
}
