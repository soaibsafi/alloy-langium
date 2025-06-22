sig Book {
    content: set Word
}

sig Word {}

pred show {
    some Book
}

run show for 3 but 1 Book
